import React from "react";

export default function Footer() {
    return (
        <footer
            style={{
        backgroundColor: "#0f172a",
            color: "#e2e8f0",
            padding: "40px 20px",
            marginTop: "40px"
    }}
>
    <div
        style={{
        maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "24px"
    }}
>
    {/* Top Section */}
    <div
        style={{
        display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "24px"
    }}
>
    <div>
        <h3 style={{ marginBottom: "12px", color: "#ffffff" }}>
    Hurricane Damage Viewer
    </h3>
    <p style={{ maxWidth: "300px", lineHeight: "1.6" }}>
    Interactive satellite imagery comparison for disaster
        assessment and impact visualization.
    </p>
    </div>

    <div>
    <h4 style={{ marginBottom: "12px", color: "#ffffff" }}>
    Navigation
    </h4>
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
    <li>
        <a href="#" style={linkStyle}>Home</a>
    </li>
    <li>
    <a href="#" style={linkStyle}>Map</a>
    </li>
    <li>
    <a href="#" style={linkStyle}>About</a>
    </li>
    </ul>
    </div>

    <div>
    <h4 style={{ marginBottom: "12px", color: "#ffffff" }}>
    Data
    </h4>
    <p style={{ maxWidth: "250px", lineHeight: "1.6" }}>
    Imagery provided for research and educational purposes.
        Georeferenced in WGS84 (EPSG:4326).
    </p>
    </div>
    </div>

    {/* Bottom Section */}
    <div
        style={{
        borderTop: "1px solid #334155",
            paddingTop: "20px",
            textAlign: "center",
            fontSize: "14px",
            color: "#94a3b8"
    }}
>
© {new Date().getFullYear()} Hurricane Damage Viewer. All rights reserved.
    </div>
    </div>
    </footer>
);
}

const linkStyle: React.CSSProperties = {
    color: "#cbd5e1",
    textDecoration: "none",
    display: "block",
    marginBottom: "6px"
};