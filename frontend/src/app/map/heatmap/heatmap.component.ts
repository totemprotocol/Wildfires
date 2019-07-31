import {Component, OnInit} from '@angular/core';
import 'leaflet/dist/leaflet.css';
import * as $ from 'jquery';
import HeatmapOverlay from 'leaflet-heatmap/leaflet-heatmap.js';
import {MapService} from '../../services/map-service/map.service';
import 'leaflet-maskcanvas';
import 'leaflet-velocity-ts';
import * as Highcharts from 'highcharts';

import {SearchService} from '../../services/search/search.service';
import {FireTweetLayer} from '../layers/FireTweetLayer';
import {WindLayer} from '../layers/WindLayer';
import {FireEventLayer} from '../layers/FireEventLayer';
import {Subject} from 'rxjs';
import {Boundary} from '../../models/boundary.model';


declare let L;

@Component({
    selector: 'app-heatmap',
    templateUrl: './heatmap.component.html',
    styleUrls: ['./heatmap.component.css']
})
export class HeatmapComponent implements OnInit {

    private static STATE_LEVEL_ZOOM = 8;
    private static COUNTY_LEVEL_ZOOM = 9;
    private mainControl;
    private tweetData;
    private tweetLayer;
    private map;
    private theSearchMarker;
    private theHighlightMarker;
    private geojsonLayer;
    private fireTweetLayer;
    private windLayer;
    private fireEventLayer;

    // Set up for a range and each smaller interval of temp to give specific color layers
    private tempLayers = [];
    private tempLayer;
    private tempBreaks = [-6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

    private colorList = ['#393fb8', '#45afd6', '#49ebd8', '#49eb8f',
        '#a6e34b', '#f2de5a', '#edbf18', '#e89c20',
        '#f27f02', '#f25a02', '#f23a02', '#f0077f',
        '#f205c3', '#9306ba'
    ];

    // For temp range selector store current max/min selected by user
    private tempRegionsMax = [];
    private tempMax = 36;
    private tempMin = 0;

    //For what to present when click event happens
    //private circle;
    private marker;

    constructor(private mapService: MapService, private searchService: SearchService) {
    }

    ngOnInit() {
        // Initialize map and 3 base layers
        const mapBoxUrl = 'https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiY' +
            'SI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';
        const satellite = L.tileLayer(mapBoxUrl, {id: 'mapbox.satellite'});
        const streets = L.tileLayer(mapBoxUrl, {id: 'mapbox.streets'});
        const dark = L.tileLayer(mapBoxUrl, {id: 'mapbox.dark'});
        this.map = L.map('map', {
            center: [33.64, -117.84],
            zoom: 5,
            maxzoom: 22,
            layers: [satellite, streets, dark]
        });

        // Initialize base layer group
        const baseLayers = {
            '<span style =\'color:blue\'>Satellite</span>': satellite,
            '<span style =\'color:red\'>Streets</span>': streets,
            '<span style =\'color:black\'>Dark</span>': dark
        };

        this.mainControl = L.control.layers(baseLayers).addTo(this.map);

        // Generate coordinate in sidebar
        this.map.addEventListener('mousemove', (ev) => {
            const lat = ev.latlng.lat;
            const lng = ev.latlng.lng;
            $('#mousePosition').html('Lat: ' + Math.round(lat * 100) / 100 + ' Lng: ' + Math.round(lng * 100) / 100);
        });

        // get boundary on init
        this.getBoundary();

        // Get temperature data from service
        const tempSubject = new Subject();
        tempSubject.subscribe(this.dotMapDataHandler);
        tempSubject.subscribe(this.heatmapDataHandler);
        this.mapService.getTemperatureData().subscribe(tempSubject);

        // Get tweets data from service
        this.fireTweetLayer = new FireTweetLayer(this.mainControl, this.mapService);

        // Get fire events data from service
        this.fireEventLayer = new FireEventLayer(this.mainControl, this.mapService);

        // Get wind events data from service
        this.windLayer = new WindLayer(this.mainControl, this.mapService);

        // Get boundary data from service to draw it on map
        this.searchService.searchDataLoaded.subscribe(this.boundaryDataHandler);


        // Add event Listener when user specify a time range on time series
        $(window).on('timeRangeChange', this.timeRangeChangeHandler);

        // Send temp range selected from service
        this.mapService.temperatureChangeEvent.subscribe(this.rangeSelectHandler);
        this.map.on('zoomend, moveend', this.getBoundary);

        this.clickOnMap();
        this.mapService.ClickPointLoaded.subscribe(this.clickPointHandler);

        this.mapService.getRecentTweetData();
        this.mapService.RecentTweetLoaded.subscribe(this.recentTweetLoadHandler);
    }

    getBoundary = () => {
        // gets the screen bounds and zoom level to get the corresponding geo boundaries from database
        const zoom = this.map.getZoom();
        const bound = this.map.getBounds();
        const boundNE = {lat: bound._northEast.lat, lon: bound._northEast.lng};
        const boundSW = {lat: bound._southWest.lat, lon: bound._southWest.lng};
        // tslint:disable-next-line:one-variable-per-declaration
        let showCityLevel, showStateLevel, showCountyLevel;

        // the boundary display with zoom levels is defined arbitrarily
        if (zoom < HeatmapComponent.STATE_LEVEL_ZOOM) {
            showCityLevel = false;
            showCountyLevel = false;
            showStateLevel = true;
        } else if (zoom < HeatmapComponent.COUNTY_LEVEL_ZOOM) {
            showCityLevel = false;
            showCountyLevel = true;
            showStateLevel = true;
        } else {
            showCityLevel = true;
            showCountyLevel = true;
            showStateLevel = true;
        }


        this.mapService.getBoundaryData(showStateLevel, showCountyLevel, showCityLevel, boundNE, boundSW)
            .subscribe(this.getBoundaryScreenDataHandler);
    }

    getBoundaryScreenDataHandler = (data: Boundary) => {
        // adds boundary layer onto the map
        if (!this.map.hasLayer(this.geojsonLayer) && this.geojsonLayer) {
            return;
        }

        // remove previous overlay
        if (this.geojsonLayer) {
            this.map.removeLayer(this.geojsonLayer);
            this.mainControl.removeLayer(this.geojsonLayer);
        }
        this.geojsonLayer = L.geoJson(data, {
            style: this.style,
            onEachFeature: this.onEachFeature
        });

        this.mainControl.addOverlay(this.geojsonLayer, 'Boundary');
        this.map.addLayer(this.geojsonLayer);
    }


    timeRangeChangeHandler = (event, data) => {
        const tempData = [];
        this.tweetData.forEach(entry => {
            if (entry[2] > data.timebarStart && entry[2] < data.timebarEnd) {
                tempData.push([entry[0], entry[1]]);
            }
        });
        this.tweetLayer.setData(tempData);
    };

    fireEventHandler = (data) => {

        const fireEventList = [];

        for (const ev of data.fireEvents) {
            const point = [ev.lat, ev.long];
            const size = 40;
            const fireIcon = L.icon({
                iconUrl: 'assets/image/pixelfire.gif',
                iconSize: [size, size],
            });
            const marker = L.marker(point, {icon: fireIcon}).bindPopup('I am on fire(image>40%). My evidence is:<br/>' + ev.text);
            fireEventList.push(marker);

        }
        const fireEvents = L.layerGroup(fireEventList);
        this.mainControl.addOverlay(fireEvents, 'Fire event');
    };

    windDataHandler = (wind) => {
        // there's not much document about leaflet-velocity.
        // all we got is an example usage from
        // github.com/0nza1101/leaflet-velocity-ts
        const velocityLayer = L.velocityLayer({
            displayValues: true,
            displayOptions: {
                position: 'bottomleft', // REQUIRED !
                emptyString: 'No velocity data', // REQUIRED !
                angleConvention: 'bearingCW', // REQUIRED !
                velocityType: 'Global Wind',
                displayPosition: 'bottomleft',
                displayEmptyString: 'No wind data',
                speedUnit: 'm/s'
            },
            data: wind.data,
            maxVelocity: 12 // affect color and animation speed of wind
        });
        this.mainControl.addOverlay(velocityLayer, 'Global wind');
    };

    heatmapDataHandler = (data) => {
        // use heatmapOverlay from leaflet-heatmap
        // Documentation for details in change of custom parameter
        // https://www.patrick-wied.at/static/heatmapjs/docs.html#heatmap-setData
        const heatmapConfig = {
            radius: 1,
            maxOpacity: 0.63,
            minOpacity: 0.2,
            scaleRadius: true,
            useLocalExtrema: false,
            blur: 1,
            latField: 'lat',
            lngField: 'long',
            valueField: 'temp',
            // gradient is customized to match the color scales of temp plotting layers exactly the same
            gradient: {
                '.1': '#393fb8',
                '.2': '#45afd6',
                '.3': '#49ebd8',
                '.4': '#49eb8f',
                '.5': '#a6e34b',
                '.55': '#f2de5a',
                '.6': '#edbf18',
                '.65': '#e89c20',
                '.7': '#f27f02',
                '.75': '#f25a02',
                '.8': '#f23a02',
                '.85': '#f0077f',
                '.9': '#f205c3',
                '.99': '#9306ba',
            }
        };
        const heatmapLayer = new HeatmapOverlay(heatmapConfig);
        heatmapLayer.setData({max: 680, data});
        this.mainControl.addOverlay(heatmapLayer, 'Temp heatmap');
    }

    dotMapDataHandler = (data) => {
        const latLongBins = [];
        // Classify points for different temp into different list
        for (let t = 0; t < this.tempBreaks.length - 1; t++) {
            const points = [];
            for (const point of data) {
                if (point.temp >= this.tempBreaks[t] && point.temp <= this.tempBreaks[t + 1]) {
                    points.push([Number(point.lat), Number(point.long)]);
                }
            }
            latLongBins.push(points);
        }
        // Assign a different color and a layer for each small temperature interval
        for (let i = 0; i < this.colorList.length; i++) {
            this.tempLayer = L.TileLayer.maskCanvas({
                radius: 5,
                useAbsoluteRadius: true,
                color: '#000',
                opacity: 0.85,
                noMask: true,
                lineColor: this.colorList[i]
            });
            this.tempLayer.setData(latLongBins[i]);
            this.tempLayers.push(this.tempLayer);
        }
    }

    clickOnMap = () => {
        const that = this;
        this.map.on('click', onMapClick);
        //let marker;
        let circle;
        let pinRadius = 100000;

        function onMapClick(e) {
            that.mapService.getClickData(e.latlng.lat, e.latlng.lng, pinRadius / 111000);
            const clickIcon = L.icon({
                iconUrl: 'assets/image/pin6.gif',
                iconSize: [26, 30],
            });
            if (that.marker) { // check
                that.map.removeLayer(that.marker); // remove
            }
            that.marker = L.marker(e.latlng, {draggable: false, icon: clickIcon}).addTo(that.map);

            if (circle) { // check
                that.map.removeLayer(circle); // remove
            }
            circle = L.circle(e.latlng, {
                color: 'white',
                fillColor: 'white',
                fillOpacity: 0.35,
                radius: pinRadius
            }).addTo(that.map);
            that.marker.bindPopup('You clicked the map at ' + e.latlng.toString()).openPopup();
            that.marker.getPopup().on('remove', function () {
                that.map.removeLayer(that.marker);
                that.map.removeLayer(circle);
            });
        }
    }

    clickPointHandler = (data) => {
        console.log(data)

        function drawChart(timeArray, tempArray, moistureArray) {
            Highcharts.chart('container', {
                title: {
                    text: '',
                },
                chart: {
                    zoomType: 'x',
                    style: {
                        fontSize: '10px',
                    },
                },
                xAxis: {
                    categories: timeArray,
                    crosshair: true,
                },
                plotOptions: {
                    series: {
                        allowPointSelect: true,
                    }
                },
                yAxis: [{ // Primary yAxis
                    labels: {
                        format: '{value}°C',
                        style: {
                            color: Highcharts.getOptions().colors[1],
                            fontSize: '8px',
                        }
                    },
                    title: {
                        text: '',
                    }
                }, { // Secondary yAxis
                    title: {
                        text: '',
                    },
                    labels: {
                        format: '{value} mm',
                        style: {
                            color: Highcharts.getOptions().colors[0],
                            fontSize: '8px',
                        }
                    },
                    opposite: true
                }],
                tooltip: {
                    shared: true,
                },
                series: [{
                    name: 'Rainfall',
                    type: 'spline',
                    yAxis: 1,
                    data: moistureArray,
                    tooltip: {
                        valueSuffix: ' mm'
                    },
                    showInLegend: false

                }, {
                    name: 'Temperature',
                    type: 'spline',
                    data: tempArray,
                    yAxis: 0,
                    tooltip: {
                        valueSuffix: '°C'
                    },
                    showInLegend: false
                }]
            });
        }

        const tmpTime = [];
        const tmpValue = [];
        for (const i of data.tmp) {
            tmpTime.push(i[0]);
            tmpValue.push(i[1]);
            //tmpValue.push(Number(i[1] - 273.15).toFixed(2));
        }

        const soilwTime = [];
        const soilwValue = [];
        for (const j of data.soilw) {
            soilwTime.push(j[0]);
            soilwValue.push(j[1]);
            //soilwValue.push(j[1].toFixed(3));
        }

        let contentToShow: string;
        contentToShow = 'Temperature Average: ' + tmpValue + '<br/>Solid Moisture Average: ' + soilwValue
            + '<br/>All Historical Tweet Count: ' + data.cnt_tweet;

        const chartContents = '<div id="container" style="width: 300px; height: 150px;"></div>'
        ;

        this.marker.bindPopup(chartContents).openPopup();
        drawChart(tmpTime, tmpValue, soilwValue);
        console.log(tmpTime, tmpValue, soilwValue);
        //drawChart([1,2,3,4,5,6,7], [1,2,3,4,5,6,7], [1,2,3,4,5,6,7]);
        this.marker.getPopup().on('remove', function () {
            this.map.removeLayer(this.marker);
        });
    }

    recentTweetLoadHandler = (data) => {
        console.log(data)


        function translateTweetDataToShow(tweetJSON) {
            // still need username, userPhotoUrl,imageurl from database
            let tweetid = '';
            try {
                tweetid = tweetJSON.id;
            } catch (e) {
                // tweetid missing in this Tweet.
            }

            let userName = '';
            try {
                userName = tweetJSON.user;//tweetJSON[5];
            } catch (e) {
                // userName missing in this Tweet.
            }

            let userPhotoUrl = '';
            try {
                //'http://p1.qhimg.com/t015b79f2dd6a285745.jpg'
                userPhotoUrl = tweetJSON.profilePic;//tweetJSON[6];
            } catch (e) {
                // user.profile_image_url missing in this Tweet.
            }

            let tweetText = '';
            try {
                tweetText = tweetJSON.text;
            } catch (e) {
                //Text missing in this Tweet.
            }

            let tweetTime = '';
            try {
                let createdAt = new Date(tweetJSON.create_at);
                tweetTime = createdAt.toISOString();
            } catch (e) {
                //Time missing in this Tweet.
            }

            let tweetLink = '';
            try {
                tweetLink = 'https://twitter.com/' + userName + '/status/' + tweetid;
            } catch (e) {
                //tweetLink missing in this Tweet.
            }

            let imageUrl = '';
            try {
                imageUrl = tweetJSON.image; // 'https://pbs.twimg.com/media/DE6orpqVYAAeCYz.jpg'
            } catch (e) {
                //imageLink missing in this Tweet.
            }

            let tweetTemplate;

            //handles exceptions:
            if (tweetText === '' || null || undefined) {
                tweetTemplate = "\n"
                    + "<div>"
                    + "Fail to get Tweets data."
                    + "</div>\n";
            } else {
                //presents all the information.
                tweetTemplate = "\n"
                    + "<div class=\"tweet\">\n "
                    + "  <div class=\"tweet-body\">"
                    + "    <div class=\"user-info\"> "
                    + "      <img src=\""
                    + userPhotoUrl
                    + "\" onerror=\" this.src='/assets/images/default_pinicon.png'\" style=\"width: 32px; display: inline; \">\n"
                    + "      <span class=\"name\" style='color: #0e90d2; font-weight: bold'> "
                    + userName
                    + "      </span> "
                    + "    </div>\n	"
                    + "    <span class=\"tweet-time\" style='color: darkgray'>"
                    + tweetTime
                    + "    <br></span>\n	 "
                    + "    <span class=\"tweet-text\" style='color: #0f0f0f'>"
                    + tweetText
                    + "    </span><br>\n	 "
                    + "\n <a href=\""
                    + tweetLink
                    + "\"> "
                    + tweetLink
                    + "</a>"
                    + "  </div>\n	"
                    + "      <img src=\""
                    + imageUrl
                    + "\" onerror=\" this.src='http://www.defaulticon.com/images/icons32x32/alert-alt.png?itok=hIkRlO7s'\" style=\"width: 180px; \">\n"
                    + "</div>\n";
            }
            return tweetTemplate;
        }

        const fireEventList = [];
        for (const ev of  data.slice(0, 150)) {
            const point = [ev.lat, ev.long];
            const size = 12.5;
            const fireIcon = L.icon({
                iconUrl: 'assets/image/perfectBird.gif',
                iconSize: [size, size],
            });
            const tweetContent = translateTweetDataToShow(ev);
            //const tweetContent = 'CONTENT: ' + ev[4] + '<br/>TIME: ' + ev[2] + '<br/>TWEETID#: ' + ev[3];
            const marker = L.marker(point, {icon: fireIcon}).bindPopup(tweetContent);
            fireEventList.push(marker);

        }
        const fireEvents = L.layerGroup(fireEventList);
        this.mainControl.addOverlay(fireEvents, 'Recent tweet (within 2 days)');

    }

    rangeSelectHandler = (event) => {
        const inRange = (min: number, max: number, target: number) => {
            return target < max && target >= min;
        };

        // Respond to the input range of temperature from the range selector in side bar
        // var int: always keep the latest input Max/Min temperature
        if (event.high !== undefined) {
            this.tempMax = event.high;
        }
        if (event.low !== undefined) {
            this.tempMin = event.low;
        }
        if (this.tempMin <= this.tempMax) {
            this.tempRegionsMax = [];
            let startSelecting = false;
            // Push layers in selected range into list tempRegionsMax
            for (let i = 0; i < this.tempBreaks.length - 1; i++) {
                const rangeMin = this.tempBreaks[i];
                const rangeMax = this.tempBreaks[i + 1];
                if (inRange(rangeMin, rangeMax, this.tempMin)) {
                    startSelecting = true;
                }
                if (startSelecting) {
                    this.tempRegionsMax.push(this.tempLayers[i]);
                }
                if (inRange(rangeMin, rangeMax, this.tempMax)) {
                    startSelecting = false;
                    break;
                }
            }

        }
        // Remove previous canvas layers
        for (const layer of this.tempLayers) {
            this.map.removeLayer(layer);
        }
        // Add new canvas layers in the updated list tempRegionsMax to Map
        for (const region of this.tempRegionsMax) {
            region.addTo(this.map);
        }
    }

    boundaryDataHandler = ([[data], value]) => {
        console.log(data);
        // given the boundary data after the keyword search, fits the map according to the boundary and shows the name label
        const listWithFixedLL = [];
        if (data) {
            // list will be converted because of the lat and lon are misplaced
            console.log(data.coordinates[0]);
            for (const item of data.coordinates[0]) {
                listWithFixedLL.push([parseFloat(item[1]), parseFloat(item[0])]);
            }
            this.map.fitBounds(listWithFixedLL); // fits map according to the given fixed boundary list

            if (this.theSearchMarker) {
                // removes previous marker
                this.map.removeControl(this.theSearchMarker);
            }

            // TODO: separate a component for name label
            // creates the name label
            const divIcon = L.divIcon({
                html: '<span style=\'color:#ffffff;font-size:18px;\' id=\'userInput\'>' + value + '</span>',
                iconSize: [this.map.getZoom(), this.map.getZoom()],
            });
            const centerLatlng = this.getPolygonCenter(listWithFixedLL);
            this.theSearchMarker = L.marker(new L.LatLng(centerLatlng[0], centerLatlng[1]), {icon: divIcon}).addTo(this.map);
            this.setLabelStyle(this.theSearchMarker); // sets the label style

        }
    }
    setLabelStyle = (marker) => {
        // sets the name label style
        marker.getElement().style.backgroundColor = 'transparent';
        marker.getElement().style.border = 'transparent';
        marker.getElement().style.fontFamily = 'monospace';
        marker.getElement().style.webkitTextStroke = '#ffe710';
        marker.getElement().style.webkitTextStrokeWidth = '0.5px';
    }


    resetHighlight = (event) => {
        // gets rid of the highlight when the mouse moves out of the region
        if (this.theHighlightMarker) {
            this.map.removeControl(this.theHighlightMarker);
        }
        if (this.theSearchMarker) {
            this.map.removeControl(this.theSearchMarker);
        }
        this.geojsonLayer.resetStyle(event.target);
    }

    zoomToFeature = (event) => {
        // zooms to a region when the region is clicked
        this.map.fitBounds(event.target.getBounds());

    }
    getPolygonCenter = (coordinateArr) => {
        // gets the center point when given a coordinate array
        // OPTIMIZE: the get polygon center function
        const x = coordinateArr.map(a => a[0]);
        const y = coordinateArr.map(a => a[1]);
        const minX = Math.min.apply(null, x);
        const maxX = Math.max.apply(null, x);
        const minY = Math.min.apply(null, y);
        const maxY = Math.max.apply(null, y);
        return [(minX + maxX) / 2, (minY + maxY) / 2];
    }
    getColor = (density) => {
        // color for the boundary layers
        // TODO: remove this func
        switch (true) {
            case (density > 1000):
                return '#802403';
            case (density > 500):
                return '#BD0026';
            case (density > 200):
                return '#E31A1C';
            case (density > 100):
                return '#FC4E2A';
            case (density > 50):
                return '#FD8D3C';
            case (density > 20):
                return '#FEB24C';
            case (density > 10):
                return '#FED976';
            default:
                return '#FFEDA0';
        }

    }
    style = (feature) => {
        // style for the boundary layers
        return {
            fillColor: this.getColor(feature.properties.density),
            weight: 2,
            opacity: 0.8,
            color: 'white',
            dashArray: '3',
            fillOpacity: 0.3
        };
    }

    highlightFeature = (event) => {
        // highlights the region when the mouse moves over the region
        const layer = event.target;
        layer.setStyle({
            weight: 5,
            color: '#e3d926',
            dashArray: '',
            fillOpacity: 0.7
        });
        // shows the name label when the area is highlighted
        const divIcon = L.divIcon({
            html: '<span style=\'color:#ffffff;font-size: 18px;\'>' + layer.feature.properties.name + '</span>',
            iconSize: [this.map.getZoom(), this.map.getZoom()],
        });
        const centerLatLng = event.target.getCenter();
        if (this.theSearchMarker) {
            this.map.removeControl(this.theSearchMarker);
        }
        if (this.theHighlightMarker) {
            this.map.removeControl(this.theHighlightMarker);
        }
        this.theHighlightMarker = L.marker(new L.LatLng(centerLatLng.lat, centerLatLng.lng), {icon: divIcon})
            .addTo(this.map);
        this.theSearchMarker = L.marker(new L.latLng([this.map.getBounds()
            ._northEast.lat - 15, this.map.getBounds()._northEast.lng - 60]), {icon: divIcon}).addTo(this.map);
        this.setLabelStyle(this.theHighlightMarker);
        this.setLabelStyle(this.theSearchMarker);
    }

    onEachFeature = (feature, layer) => {
        // controls the interaction between the mouse and the map
        layer.on({
            mouseover: this.highlightFeature,
            mouseout: this.resetHighlight,
            click: this.zoomToFeature
        });
    }

}