import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'  # Replace with a secure secret key

# Mock user database (replace with actual database in production)
users_db = {}

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if username in users_db:
        return jsonify({"message": "User already exists"}), 400
    
    hashed_password = generate_password_hash(password)
    users_db[username] = hashed_password
    
    return jsonify({"message": "User registered successfully"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if username not in users_db:
        return jsonify({"message": "Invalid credentials"}), 401
    
    if check_password_hash(users_db[username], password):
        token = jwt.encode({
            'user': username,
            'exp': datetime.utcnow() + timedelta(hours=1)
        }, app.config['SECRET_KEY'])
        
        return jsonify({"token": token}), 200
    
    return jsonify({"message": "Invalid credentials"}), 401

if __name__ == '__main__':
    app.run(port=5000)
