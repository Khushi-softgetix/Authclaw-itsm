"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { marketingNavigation, marketingRoutes, productMenuItems } from "./config";

export function MarketingHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [mobileProductExpanded, setMobileProductExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (productOpen) {
          setProductOpen(false);
        }
        if (open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    }
    function handleClickOutside(event: MouseEvent) {
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target as Node)
      ) {
        setProductOpen(false);
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", handleClickOutside);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, [open, productOpen]);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setProductOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setProductOpen(false);
    }, 150);
  };

  if (pathname === "/itsm" || pathname?.startsWith("/itsm")) {
    return null;
  }

  const isProductActive =
    pathname === "/product";

  return (
    <header className="nav">
      <div className="wrap nav-in">
        <Link className="brand" href={marketingRoutes.home} aria-label="AuthClaw home">
          <span className="mark" aria-hidden="true" />
          AuthClaw<span className="ai">.ai</span>
        </Link>
        <nav className="links" aria-label="Primary navigation">
          {marketingNavigation.map((item) => {
            if (item.label === "Product") {
              return (
                <div
                  key={item.href}
                  className="nav-dropdown"
                  ref={productDropdownRef}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  <button
                    type="button"
                    className={`nav-dropdown-trigger${isProductActive ? " active" : ""}`}
                    aria-expanded={productOpen}
                    aria-haspopup="menu"
                    id="product-menu-trigger"
                    onClick={() => setProductOpen((prev) => !prev)}
                  >
                    Product
                    <svg
                      className="nav-dropdown-chevron"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <div
                    className={`nav-dropdown-menu${productOpen ? " open" : ""}`}
                    role="menu"
                    aria-labelledby="product-menu-trigger"
                  >
                    {productMenuItems.map((product) => (
                      <Link
                        key={product.label}
                        href={product.href}
                        role="menuitem"
                        className="nav-dropdown-item"
                        onClick={() => setProductOpen(false)}
                      >
                        <div className="nav-dropdown-item-header">
                          <span className="nav-dropdown-item-title">{product.label}</span>
                          {product.badge && (
                            <span className="nav-dropdown-badge">{product.badge}</span>
                          )}
                        </div>
                        <p className="nav-dropdown-item-desc">{product.description}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <Link
                className={pathname === item.href ? "active" : undefined}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-cta">
          <Link className="login" href={marketingRoutes.login}>
            Log in
          </Link>
          <Link className="btn btn-primary" href={marketingRoutes.demo} style={{ color: "#ffffff" }}>
            <span style={{ color: "#ffffff" }}>Book a demo</span>
          </Link>
          <button
            ref={buttonRef}
            className="burger"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-controls="marketing-mobile-menu"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav
        className={`mobilemenu${open ? " open" : ""}`}
        id="marketing-mobile-menu"
        aria-label="Mobile navigation"
        hidden={!open}
      >
        {marketingNavigation.map((item) => {
          if (item.label === "Product") {
            return (
              <div key={item.href}>
                <button
                  type="button"
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "13px 24px",
                    border: "none",
                    borderTop: "1px solid var(--line-2)",
                    background: "none",
                    color: isProductActive ? "var(--ink)" : "var(--slate)",
                    fontWeight: isProductActive ? 600 : 500,
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onClick={() => setMobileProductExpanded((prev) => !prev)}
                  aria-expanded={mobileProductExpanded}
                >
                  <span>Product</span>
                  <span style={{ fontSize: "12px", opacity: 0.7 }}>
                    {mobileProductExpanded ? "▲" : "▼"}
                  </span>
                </button>
                {mobileProductExpanded && (
                  <div className="mobilemenu-sublist">
                    {productMenuItems.map((product) => (
                      <Link
                        key={product.label}
                        href={product.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 24px 10px 36px",
                          borderTop: "1px solid var(--line-2)",
                          color: pathname === product.href ? "var(--ink)" : "var(--slate)",
                          fontWeight: pathname === product.href ? 600 : 500,
                          fontSize: "14px",
                        }}
                        onClick={() => {
                          setOpen(false);
                          setMobileProductExpanded(false);
                        }}
                      >
                        <span>{product.label}</span>
                        {product.badge && (
                          <span className="nav-dropdown-badge">{product.badge}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              className={pathname === item.href ? "active" : undefined}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="mm-cta">
          <Link className="btn btn-ghost" href={marketingRoutes.login}>
            Log in
          </Link>
          <Link className="btn btn-primary" href={marketingRoutes.demo} style={{ color: "#ffffff" }}>
            <span style={{ color: "#ffffff" }}>Book a demo</span>
          </Link>
        </div>
      </nav>
    </header>
  );
}
