import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import axios from 'axios';

jest.mock('axios');

test('muestra el formulario de inicio de sesión al abrir la aplicación', () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByRole('heading', { name: /bienvenido de nuevo/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/correo electrónico/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^contraseña/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /iniciar sesión/i })).toBeInTheDocument();
});

test('abre el registro y solicita el nivel de conocimiento', () => {
  localStorage.clear();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /crear una cuenta/i }));
  expect(screen.getByRole('heading', { name: /crear una cuenta/i })).toBeInTheDocument();
  expect(screen.getByText(/tienes conocimientos técnicos avanzados sobre el proyecto/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^sí$/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^no$/i)).toBeInTheDocument();
});

test('el modo avanzado requiere aceptar la advertencia antes de enviar el registro', () => {
  localStorage.clear();
  axios.post.mockClear();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /crear una cuenta/i }));
  fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Usuario Técnico' } });
  fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: 'tecnico@example.com' } });
  fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: 'Password#1234' } });
  fireEvent.change(screen.getByLabelText(/confirmar contraseña/i), { target: { value: 'Password#1234' } });
  fireEvent.click(screen.getByLabelText(/^sí$/i));
  fireEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Ingresas bajo tu propio riesgo');
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /volver/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
