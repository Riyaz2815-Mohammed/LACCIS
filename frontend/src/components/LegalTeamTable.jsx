import './LegalTeamTable.css';

function LegalTeamTable({ members, loading, onDelete }) {
    if (loading) {
        return (
            <table className="table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            Loading legal team members...
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    if (members.length === 0) {
        return (
            <table className="table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No legal team members yet. Create one above!
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    return (
        <table className="table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {members.map((member) => (
                    <tr key={member.id}>
                        <td>{member.name}</td>
                        <td>{member.email}</td>
                        <td><span className="badge badge-success">Active</span></td>
                        <td>{new Date(member.created_at).toLocaleDateString()}</td>
                        <td>
                            <button
                                className="btn-action btn-delete"
                                onClick={() => onDelete(member)}
                                title="Delete Member"
                            >
                                🗑️
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default LegalTeamTable;
