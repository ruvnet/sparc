from flask import Flask, request, jsonify
import jwt
import requests

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'  # Replace with a secure secret key

def token_required(f):
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({"message": "Token is missing"}), 401
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
        except:
            return jsonify({"message": "Token is invalid"}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/api/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
@token_required
def api_gateway(path):
    # Route requests to appropriate microservices
    # This is a simplified example; you'd implement actual routing logic here
    response = requests.request(
        method=request.method,
        url=f"http://localhost:5001/{path}",
        headers={key: value for (key, value) in request.headers if key != 'Host'},
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False)
    
    return (response.content, response.status_code, response.headers.items())

if __name__ == '__main__':
    app.run(port=5002)
