# Imageai: free, but perform worse, able to detect obvious object.
# eg: car, obvious fire. Unable to do sth not obvious.

# 0. This libarary also deal with video.
# 1. Can use image to filter out some obvious irrelevant images then use Google cloud Vision which has cost.
# 2. Can do custom training for imageai，the library has the custom function, but need training database.

#from imageai.Prediction import ImagePrediction
import os
import json
import sys
from connection import Connection
#from imageai.Prediction.Custom import CustomImagePrediction
import webbrowser

# This model also need install -- tensorflow, numpy, scipy, opencv-python, h5py, keras
# pip3 install https://github.com/OlafenwaMoses/ImageAI/releases/download/2.0.2/imageai-2.0.2-py3-none-any.whl

# url = "https://pbs.twimg.com/media/CVBkO6hVEAEZlG2.jpg"
# label_list = ["vocano","wildfire","web_site", "comic_book"]


def load_picture(url_file):  # from json
    with open(url_file, 'rb') as file:
        try:
            data = json.load(file)
            tweetPhoto_url_dict = dict()  # this dictionary stores id: url that contains tweets that have pics
            for id, urls in data.items():
                for url in urls:
                    # pic_id = id + '-' + str(urls.index(url))
                    # print(url, pic_id)
                    print(label_pic(url, label_list))
        except ValueError as e:
            print("JSON object issue")


def get_image_url(feature):  # from database
    return next(Connection().sql_execute(f"select id, image_url from images where {feature} IS NULL limit 1"))



def upload_features_labeled(id, feature_label):
    with Connection() as conn:
        cur = conn.cursor()
        for feature_label in feature_labels:
            label = int(input("1=yes, 0=no"))
            while (label != 1) and (label != 0):
                label = int(input("1=yes, 0=no"))
            cur.execute(f"update images set {feature_label} = {label} where id = {id}")
        cur.close()
        conn.commit()

if __name__ == '__main__':
    feature_labels = ["wildfire_labeled"]
    while True:
        for feature_label in feature_labels:
            id, url = get_image_url(feature_label)
        print(id, url)
        webbrowser.open(url)
        #label = input("1=yes, 0=no")
        upload_features_labeled(id, feature_labels)

    # url_file = "../data/image_urls.json"  # this data set is generated by kerry's branch code
    # load_picture(url_file)