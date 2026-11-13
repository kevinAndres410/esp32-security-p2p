import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const WARNING = 'El acceso avanzado permite gestionar nodos, claves y solicitudes de dispositivos. Tu cuenta se creará con acceso básico y un Administrador Maestro revisará tu solicitud. Si se aprueba, deberás volver a iniciar sesión para usar estas herramientas. ¿Deseas solicitarlo?';

export default function Register({ onBack, onSuccess }) {
  const [form, setForm] = useState({ nombre: '', email: '', password: '', confirmPassword: '', knowledge: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  useEffect(() => {
    if (!warningOpen) return undefined;
    const previous = document.activeElement;
    document.getElementById('advanced-warning-title')?.focus();
    return () => previous?.focus();
  }, [warningOpen]);
  const strength = useMemo(() => passwordStrength(form.password), [form.password]);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const createAccount = async (accepted) => {
    setLoading(true); setError('');
    try {
      await axios.post(`${API_URL}/auth/register`, {
        nombre: form.nombre.trim(), email: form.email.trim(), password: form.password,
        tieneConocimientoTecnico: form.knowledge === 'si', aceptaRiesgosAvanzados: accepted,
      });
      localStorage.setItem('rememberedEmail', form.email.trim().toLowerCase());
      onSuccess(form.knowledge === 'si'
        ? 'Cuenta creada. Puedes iniciar sesión; el acceso avanzado requiere aprobación del administrador.'
        : 'Cuenta creada correctamente. Ya puedes iniciar sesión.');
    } catch (requestError) {
      setWarningOpen(false);
      setError(requestError.response?.data?.error || 'No fue posible crear la cuenta.');
    } finally { setLoading(false); }
  };

  const submit = (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    if (strength < 4) { setError('La contraseña debe tener 12 caracteres, mayúscula, minúscula, número y símbolo.'); return; }
    if (form.knowledge === '') { setError('Selecciona tu nivel de conocimiento.'); return; }
    if (form.knowledge === 'si') { setWarningOpen(true); return; }
    createAccount(false);
  };

  return <main className="login-page"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><section className="login-card register-card" aria-labelledby="register-title"><div className="login-logo">S</div><p className="eyebrow">NUEVA CUENTA</p><h1 id="register-title">Crear una cuenta</h1><p className="subtitle">Cada usuario recibe el mismo kit ESP32; el nivel técnico solo cambia las herramientas disponibles.</p><form className="login-form" onSubmit={submit}>{error && <p className="feedback error" role="alert">{error}</p>}<label>Nombre completo<input value={form.nombre} onChange={update('nombre')} autoComplete="name" placeholder="Nombre y apellido" minLength="3" required /></label><label>Correo electrónico<input type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="nombre@ejemplo.com" required /></label><div className="register-passwords"><label>Contraseña<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password" placeholder="Mínimo 12 caracteres" minLength="12" required /></label><label>Confirmar contraseña<input type="password" value={form.confirmPassword} onChange={update('confirmPassword')} autoComplete="new-password" placeholder="Repite la contraseña" required /></label></div><div className="strength" aria-label={`Fortaleza de contraseña ${strength} de 5`}><span><i style={{ width: `${strength * 20}%` }} /></span><small>{strengthLabel(strength)}</small></div><fieldset className="knowledge-field"><legend>¿Tienes conocimientos técnicos avanzados sobre el proyecto?</legend><label><input type="radio" name="knowledge" value="si" checked={form.knowledge === 'si'} onChange={update('knowledge')} /> Sí</label><label><input type="radio" name="knowledge" value="no" checked={form.knowledge === 'no'} onChange={update('knowledge')} /> No</label></fieldset><button className="primary-button" disabled={loading}>{loading ? 'Creando cuenta…' : 'Crear cuenta →'}</button></form><footer>¿Ya tienes una cuenta? <button className="link-button" onClick={onBack}>Iniciar sesión</button></footer></section>{warningOpen && <div className="modal-backdrop"><section className="modal access-modal" role="dialog" aria-modal="true" aria-labelledby="advanced-warning-title" onKeyDown={(event) => { if (event.key === 'Escape') setWarningOpen(false); }}><h2 id="advanced-warning-title" tabIndex="-1">Solicitar acceso avanzado</h2><p>{WARNING}</p><div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setWarningOpen(false)} disabled={loading}>Volver</button><button type="button" className="primary-button" onClick={() => createAccount(true)} disabled={loading}>{loading ? 'Creando cuenta…' : 'Crear cuenta y solicitar acceso'}</button></div></section></div>}</main>;
}

function passwordStrength(password) { return [password.length >= 12, /[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length; }
const strengthLabel = (score) => ['Introduce una contraseña', 'Muy débil', 'Débil', 'Media', 'Segura', 'Muy segura'][score];
