import Cookies from 'js-cookie';
import api from './api';

export async function login(email: string, password: string) {
  const res = await api.post('/api/auth/login', { email, password });
  Cookies.set('token', res.data.token, { expires: 7 });
  return res.data;
}

export async function register(email: string, password: string) {
  const res = await api.post('/api/auth/register', { email, password });
  Cookies.set('token', res.data.token, { expires: 7 });
  return res.data;
}

export function logout() {
  Cookies.remove('token');
  window.location.href = '/login';
}

export function getToken() {
  return Cookies.get('token');
}

export function isLoggedIn() {
  return !!Cookies.get('token');
}