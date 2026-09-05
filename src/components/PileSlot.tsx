import React from 'react';
import { CARD_H, CARD_RADIUS, CARD_W } from '../utils/layout';

type SlotKind = 'stock' | 'waste' | 'foundation' | 'tableau';

interface PileSlotProps {
    kind: SlotKind;
    /** Lets the victory cascade find where each foundation sits on screen. */
    pileId?: string;
    x: number;
    y: number;
    /** Legal place to drop what is currently in hand. */
    legal?: boolean;
    /** The pile the cards are hovering over right now. */
    active?: boolean;
    /** The move the hint is pointing at. */
    hinted?: boolean;
    stockEmpty?: boolean;
    onPointerDown?: (event: React.PointerEvent) => void;
}

const SUIT_GLYPHS = ['♠', '♥', '♣', '♦'];

const PileSlot: React.FC<PileSlotProps> = ({
    kind,
    pileId,
    x,
    y,
    legal,
    active,
    hinted,
    stockEmpty,
    onPointerDown,
}) => {
    const border = active
        ? '2px solid rgba(255,236,160,0.95)'
        : legal
          ? '2px solid rgba(255,255,255,0.55)'
          : '2px solid rgba(255,255,255,0.16)';

    const glow = active
        ? '0 0 22px 5px rgba(255,206,84,0.55), inset 0 0 26px rgba(255,206,84,0.22)'
        : hinted
          ? '0 0 20px 4px rgba(255,206,84,0.45)'
          : legal
            ? '0 0 14px 2px rgba(255,255,255,0.22)'
            : 'inset 0 3px 12px rgba(0,0,0,0.32)';

    return (
        <div
            data-pile={pileId}
            onPointerDown={onPointerDown}
            style={{
                position: 'absolute',
                left: x,
                top: y,
                width: CARD_W,
                height: CARD_H,
                borderRadius: CARD_RADIUS,
                border,
                boxShadow: glow,
                background: 'rgba(0,0,0,0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 140ms ease, box-shadow 140ms ease',
                touchAction: 'none',
                cursor: kind === 'stock' ? 'pointer' : 'default',
            }}
        >
            {kind === 'foundation' && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 6,
                        color: 'rgba(255,255,255,0.20)',
                        fontSize: 30,
                        lineHeight: 1,
                        textAlign: 'center',
                    }}
                >
                    {SUIT_GLYPHS.map(glyph => (
                        <span key={glyph}>{glyph}</span>
                    ))}
                </div>
            )}

            {kind === 'stock' && stockEmpty && (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <polyline points="3 3 3 8.5 8.5 8.5" />
                </svg>
            )}
        </div>
    );
};

export default PileSlot;
