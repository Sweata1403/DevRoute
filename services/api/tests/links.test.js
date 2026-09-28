const request = require('supertest');
const app = require('../src/app');

describe('Links Routes', () => {
  let token;
  let linkCode;

  beforeAll(async () => {
    // Register and get token
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `links_${Date.now()}@example.com`, password: 'password123' });
    token = res.body.token;
  });

  describe('POST /api/links', () => {
    it('should create a short link when authenticated', async () => {
      const res = await request(app)
        .post('/api/links')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://github.com/Sweata1403/DevRoute' });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('url');
      linkCode = res.body.code;
    });

    it('should reject link creation without auth', async () => {
      const res = await request(app)
        .post('/api/links')
        .send({ url: 'https://example.com' });

      expect(res.statusCode).toBe(401);
    });

    it('should reject invalid URLs', async () => {
      const res = await request(app)
        .post('/api/links')
        .set('Authorization', `Bearer ${token}`)
        .send({ url: 'not-a-url' });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /:code (redirect)', () => {
    it('should redirect to original URL', async () => {
      if (!linkCode) return;
      const res = await request(app).get(`/${linkCode}`);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://github.com/Sweata1403/DevRoute');
    });

    it('should return 404 for unknown code', async () => {
      const res = await request(app).get('/doesnotexist999');
      expect(res.statusCode).toBe(404);
    });
  });
});