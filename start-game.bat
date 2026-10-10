@echo off
rem Double-click to play. Starts a local web server and opens the game in your browser.
title ESP Racer game server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" %*
if errorlevel 1 pause
