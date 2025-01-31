from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/process', methods=['POST'])
def process():
    data = request.get_json()
    # Process data here
    return jsonify({'message': 'Request received', 'data': data}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
