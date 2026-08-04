import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FaCheckCircle, FaExclamationTriangle, FaTimesCircle, FaInfoCircle, FaTimes, FaRocket } from 'react-icons/fa';
import '../styles/Toast.css';

const ICONS = {
  success: FaCheckCircle,
  warning: FaExclamationTriangle,
  error: FaTimesCircle,
  info: FaInfoCircle,
  release: FaRocket
};

function Toast({ id, type = 'info', title, message, duration = 5000, onClose }) {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const onCloseRef = useRef(onClose);
  const idRef = useRef(id);
  
  const Icon = ICONS[type] || ICONS.info;

  // Κρατάμε πάντα το latest onClose χωρίς να trigger το effect
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onCloseRef.current(idRef.current), 300);
  }, []); // κενό dependency array — δεν αλλάζει ποτέ

  useEffect(() => {
    if (duration <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      
      if (remaining <= 0) {
        clearInterval(interval);
        handleClose();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration, handleClose]);


  return (
    <div className={`toast toast-${type} ${isExiting ? 'toast-exit' : 'toast-enter'}`}>
      <div className="toast-icon-wrapper">
        <Icon className="toast-icon" />
      </div>
      <div className="toast-content">
        {title && <div className="toast-title">{title}</div>}
        <div className="toast-message">{message}</div>
      </div>
      <button className="toast-close" onClick={handleClose}>
        <FaTimes size={12} />
      </button>
      {duration > 0 && (
        <div className="toast-progress">
          <div className="toast-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} {...toast} onClose={removeToast} />
      ))}
    </div>
  );
}

export default Toast;
