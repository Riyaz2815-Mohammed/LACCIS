import { Link } from 'react-router-dom';
import './Navbar.css';

function Navbar({ user, onLogout, title = "LACCIS Dashboard" }) {
    const getInitials = (name) => {
        return name ? name.substring(0, 2).toUpperCase() : 'U';
    };

    return (
        <nav className="navbar">
            <div className="navbar-left">
                <h2>{title}</h2>
                {user?.role === 'admin' && (
                    <div className="nav-links">
                        <Link to="/dashboard" className="nav-link">Clients</Link>
                        <Link to="/legal-team" className="nav-link">Legal Team</Link>
                    </div>
                )}
            </div>
            <div className="user-info">
                <span>{user?.name || 'User'}</span>
                <div className="user-avatar">{getInitials(user?.name)}</div>
                <button className="btn btn-secondary" onClick={onLogout}>
                    Logout
                </button>
            </div>
        </nav>
    );
}

export default Navbar;
