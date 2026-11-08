'use client'
import { useState } from 'react'
export function Probe() { const [n, setN] = useState(0); return <button data-probe onClick={() => setN(n + 1)}>clicked {n}</button> }
