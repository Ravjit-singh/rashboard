# src/tts_server.py
from flask import Flask, request, Response
import sys
import logging

# Mute standard Flask startup logs to keep your Node console clean
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)

@app.route('/speak', methods=['POST'])
def speak():
    data = request.json
    text = data.get('text', '')
    
    if not text:
        return Response("No text provided", status=400)
    
    print(f"Generating audio for: {text[:30]}...", flush=True)

    # ==========================================
    # ⚙️ YOUR LOCAL TINY TTS LOGIC GOES HERE ⚙️
    # ==========================================
    # Example: 
    # audio_bytes = tiny_tts_model.generate(text)
    # return Response(audio_bytes, mimetype='audio/wav')
    # ==========================================

    return Response(b'', mimetype='audio/wav') # Placeholder

if __name__ == '__main__':
    print("Local TTS Microservice initialized on port 5000", flush=True)
    # Run securely bound to localhost so only Node can access it
    app.run(host='127.0.0.1', port=5000, debug=False)
