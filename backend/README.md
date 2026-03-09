# FortiNest Backend

FastAPI + SQLAlchemy + SQLite backend for FortiNest smart access management.

## Setup

1. Create a virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the server:
```bash
python run.py
```

The API will be available at `http://localhost:8000`

## API Documentation

Once running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Database

SQLite database file `mfa_sys.db` is created automatically in the backend folder.

## Environment Variables (Optional)

Create a `.env` file to override defaults:
```
DATABASE_URL=sqlite:///./mfa_sys.db
SECRET_KEY=your-super-secret-key
```

## API Endpoints

### Authentication
- `POST /auth/signup` - Register new user (admin creates house, member joins)
- `POST /auth/login` - Login and get JWT token
- `GET /auth/me` - Get current user info

### User Management (Admin only)
- `GET /users/` - List house members
- `GET /users/join-requests` - Pending join requests
- `POST /users/join-requests/{id}/approve` - Approve join request
- `POST /users/join-requests/{id}/reject` - Reject join request
- `PATCH /users/{id}/role` - Promote/demote user
- `PATCH /users/{id}/status` - Block/unblock user
- `DELETE /users/{id}` - Remove user

### Access Logs
- `GET /logs/` - Get logs (filtered by role)
- `POST /logs/` - Create log entry

### Credentials
- `GET /credentials/` - Get user's credentials
- `POST /credentials/{type}/register` - Register credential
- `DELETE /credentials/{type}` - Unregister credential
- `GET /credentials/auth-methods` - Get auth method preferences
- `PUT /credentials/auth-methods` - Update auth methods
