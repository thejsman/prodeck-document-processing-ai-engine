export default function CustomDomainNotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ fontSize: 48, fontWeight: 700, color: 'rgba(255,255,255,0.15)', margin: '0 0 16px' }}>404</p>
        <p style={{ fontSize: 16, margin: 0 }}>No microsite found at this domain.</p>
      </div>
    </div>
  );
}
