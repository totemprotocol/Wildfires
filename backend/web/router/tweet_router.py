"""
@author: Yuan Fu, Yichi Zhang
"""
import rootpath

rootpath.append()

import json
import re
import string
import requests
import twitter
from flask import Blueprint, make_response, jsonify, request as flask_request
from router.data_router import fill_series, gen_date_series
from backend.connection import Connection
from paths import TWITTER_API_CONFIG_PATH
from backend.utilities.ini_parser import parse

bp = Blueprint('tweet', __name__, url_prefix='/tweet')
api = twitter.Api(**parse(TWITTER_API_CONFIG_PATH, 'twitter-API'))


@bp.route("/live-tweet")
def send_live_tweet():
    """
    (unused)(deprecated)
    :return:
    """
    # Simulate request from a mac browser
    headers = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/72.0.3626.121 Safari/537.36 '
    }

    query_words = 'fire'  # for now let's use fire for testing

    resp = requests.get(
        f'https://twitter.com/i/search/timeline?f=tweets&vertical=news&q={query_words}%20near%3A\"United%20States'
        f'\"%20within%3A8000mi&l=en&src=typd', headers=headers)

    # Clear all punctuation from raw response body
    tr = str.maketrans("", "", string.punctuation)
    content = str(resp.content)
    content = content.translate(tr)

    id_set = set()
    return_dict = list()
    for id in re.findall("dataitemid(\d+)", content):
        obj = json.loads(str(api.GetStatus(id)))
        if "place" in obj and obj["id"] not in id_set:
            left = obj["place"]['bounding_box']['coordinates'][0][0]
            right = obj["place"]['bounding_box']['coordinates'][0][2]
            center = [(x + y) / 2.0 for x, y in zip(left, right)]
            id_set.add(obj["id"])
            return_dict.append({"lat": center[1], "long": center[0], "id": id})
    return make_response(jsonify(return_dict))


@bp.route("/tweet-count")
def send_tweet_count_data():
    """
        This func gives all historical tweets objects with id

        :returns: a list of tweet objects, each with time, lat, long, id
    """
    return make_response(
        jsonify({date.isoformat(): count for date, count in
                 Connection.sql_execute(
                     "select m.t_date, count(*) from "
                     "      (select r.create_at::timestamp::date as t_date "
                     "          from records r,locations l where r.id=l.id  group by(r.create_at)) "
                     "as m group by m.t_date order by m.t_date")}))


@bp.route("/fire-tweet", methods=['post'])
def send_fire_tweet_data():
    """
        This func gives all historical tweets objects with id

        :returns: a list of tweet objects, each with time, lat, long, id
    """

    request_json = flask_request.get_json(force=True)
    north = request_json['northEast']['lat']
    east = request_json['northEast']['lon']
    south = request_json['southWest']['lat']
    west = request_json['southWest']['lon']
    start_date_float = request_json['startDate']
    end_date_float = request_json['endDate']

    poly = 'polygon(({0} {1}, {0} {2}, {3} {2}, {3} {1}, {0} {1}))'.format(east, south, north, west)

    return make_response(
        jsonify([{"create_at": time.isoformat(), "long": (top_left_long + bottom_right_long) / 2,
                  "lat": (top_left_lat + bottom_right_lat) / 2, "id": str(id)} for
                 time, top_left_long, top_left_lat, bottom_right_long, bottom_right_lat, id in
                 Connection.sql_execute(
                     f"""
                        SELECT r.create_at, l.top_left_long, l.top_left_lat, l.bottom_right_long, l.bottom_right_lat, 
                        r.id 
                        FROM records r JOIN locations l
                        ON r.id=l.id 
                        AND r.create_at BETWEEN to_timestamp({start_date_float / 1000}) 
                                     AND to_timestamp({end_date_float / 1000})
                        AND ST_CONTAINS(st_geomfromtext({repr(poly)}) , geom_center) 
                        """
                 )]))


@bp.route("/recent-tweet")
def send_recent_tweet_data():
    """
        This func gives recent tweets objects which must has a image
        here the interval is 10 month

        :returns: a list of tweet objects, each with time, lat, long, text, id
    """
    livetweet_query = "select it.create_at, it.top_left_long, it.top_left_lat, it.bottom_right_long, it.bottom_right_lat, it.id, it.text, i.image_url, it.profile_pic, it.user_name " \
                      "from (select r.create_at, l.top_left_long, l.top_left_lat, l.bottom_right_long, l.bottom_right_lat, l.id, r.text, r.profile_pic, r.user_name " \
                      "from records r, locations l where r.id=l.id and r.profile_pic is not null and r.create_at between (SELECT current_timestamp - interval '10 month') and current_timestamp) AS it LEFT JOIN images i on i.id = it.id where i.image_url is not null "
    return make_response(jsonify(
        [{"create_at": time.isoformat(), "long": long, "lat": lat, "id": id, "text": text, "image": image,
          "profilePic": profilePic, "user": user}
         for time, long, lat, _, _, id, text, image, profilePic, user in
         Connection.sql_execute(livetweet_query)]))


@bp.route('/region-tweet')
def region_tweet():
    """
    tweet count within specific administrative boundary

    @:param tweet_id: integer
    @:param timestamp: ISO string
    @:param days: integer
    :return: [ [date, count], ... ]
    """
    region_id = int(flask_request.args.get('region_id'))
    timestamp_str = flask_request.args.get('timestamp')
    days = int(flask_request.args.get('days', 7))

    # generate date series. values are set to None/null
    date_series = gen_date_series(days, timestamp_str)

    query = f'''
    select date(rft.create_at), count(rft."id") from
    (
        SELECT id, create_at from records rec
        where rec.create_at < TIMESTAMP '{timestamp_str}' -- UTC time zone
        -- returning PDT without time zone label
        and rec.create_at > TIMESTAMP '{timestamp_str}' - interval '{days} day'
    ) as rft,
    (
        SELECT id from locations loc,
        (
            SELECT geom from us_states WHERE state_id={region_id}
            union
                SELECT geom from us_counties WHERE county_id={region_id}
                union
                SELECT geom from us_cities WHERE city_id={region_id}
        ) as region
        where st_contains(region.geom, st_makepoint(loc.top_left_long, loc.top_left_lat))
    ) as gids
    where rft."id"= gids."id"
    GROUP BY date(rft.create_at)
    '''

    return make_response(jsonify(
        fill_series(date_series, Connection.sql_execute(query))))

@bp.route('/tweet-by-date', methods=['POST'])
def tweet_by_date():
    request_json = flask_request.get_json(force=True)
    north = request_json['northEast']['lat']
    east = request_json['northEast']['lon']
    south = request_json['southWest']['lat']
    west = request_json['southWest']['lon']
    start_date_float = request_json['startDate']
    end_date_float = request_json['endDate']

    poly = 'polygon(({0} {1}, {0} {2}, {3} {2}, {3} {1}, {0} {1}))'.format(east, south, north, west)
    print(poly)

    query = f""" select r.create_at, r.id, l.top_left_long, l.top_left_lat, l.bottom_right_long, l.bottom_right_lat
                    from records r, locations l
                     where r.id = l.id
                     and random() > 0.99
                       and r.create_at <  to_timestamp({end_date_float}/1000)
                       and r.create_at >  to_timestamp({start_date_float}/1000)
                       and ST_CONTAINS(st_geomfromtext('{poly}') ,ST_MAKEPOINT(((l.top_left_long + l.bottom_right_long) /2), ((l.top_left_lat + l.bottom_right_lat)/2)))
            """


    return make_response(
        jsonify(
            [{'create_at': create_at, 'id': id, 'lat': (top_left_lat + bottom_right_lat) / 2,
              'long': (top_left_long + bottom_right_long) / 2}
             for  create_at, id, top_left_long, top_left_lat, bottom_right_long, bottom_right_lat in
             Connection.sql_execute(query)]))


@bp.route("/tweet-from-id")
def tweet_from_id():
    """
    get detail of specific tweet

    @:param tweet_id: integer
    :return: JSON {"id", "create_at", "text", "user", "profilePic", "image"}
    """
    tweet_id = int(flask_request.args.get('tweet_id'))

    query = f'''
    select records.id, create_at, text,user_name,profile_pic,image_url from
    (
        SELECT id, create_at, text,user_name,profile_pic from records
        WHERE id = {tweet_id}
    ) as records
    LEFT JOIN images
    on records.id = images.id
    LIMIT 1
    '''

    try:
        id_, create_at, text, user_name, profile_pic, image_url = next(Connection.sql_execute(query))
        return make_response(jsonify({
            'id': str(id_),  # Javascript cannot handle int8, sending as string
            'create_at': create_at,
            'text': text,
            'user': user_name,
            'profilePic': profile_pic,
            'image': image_url
        }))
    except StopIteration:
        return ""
