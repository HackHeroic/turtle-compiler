'use client';
/* The design components read the compiler and view helpers as globals (window.TC, window.TCV),
   the same way the Claude Design files load them with <script> tags. */
import TC from '../../compiler/compiler.js';
import './vendor/tc-view.js';

if (typeof window !== 'undefined') window.TC = TC;
