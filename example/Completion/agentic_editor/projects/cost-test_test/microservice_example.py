from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/api/data', methods=['GET'])
def get_data():
    # This is a protected route that requires a valid JWT
    return jsonify({"data": "This is protected data"})

if __name__ == '__main__':
    app.run(port=5001)
