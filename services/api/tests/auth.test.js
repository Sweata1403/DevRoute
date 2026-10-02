const request = require('supertest');
const { createApp } = require('../src/app');
const app = createApp();

describe('Auth Routes', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user and return a token', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: `test_${Date.now()}@example.com`, password: 'password123' });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('token');
    });

    it('should reject registration with missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'nopw@example.com' });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrongpass' });

      expect(res.statusCode).toBe(401);
    });
  });
});