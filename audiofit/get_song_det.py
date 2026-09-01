import requests

def get_reccobeats_id(spotify_track_id):
    url = "https://api.reccobeats.com/v1/track"

    params = {
        "ids": spotify_track_id
    }

    response = requests.get(url, params=params)

    if response.status_code != 200:
        print("ReccoBeats Track Error:", response.status_code)
        print(response.text)
        return None

    data = response.json()

    try:
        return data["content"][0]["id"]
    except (KeyError, IndexError):
        print("Track not found in ReccoBeats.")
        return None


def get_audio_features(reccobeats_id):
    url = f"https://api.reccobeats.com/v1/track/{reccobeats_id}/audio-features"

    response = requests.get(url)

    if response.status_code != 200:
        print("Audio Features Error:", response.status_code)
        print(response.text)
        return None

    return response.json()


x = <track_id>
y = get_reccobeats_id(x)
print(get_audio_features(y))