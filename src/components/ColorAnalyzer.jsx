import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import convert from 'color-convert';

ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels);

export default function ColorAnalyzer() {
    const [imageData, setImageData] = useState(null);
    const [colorStats, setColorStats] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [activeChannel, setActiveChannel] = useState(null);

    const onDrop = useCallback((acceptedFiles) => {
        const file = acceptedFiles[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                setImageData(img);
                setColorStats(null);
                setActiveChannel(null);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png', '.webp']
        },
        maxFiles: 1
    });

    const resetImage = () => {
        setImageData(null);
        setColorStats(null);
        setActiveChannel(null);
    };

    const analyzeImage = () => {
        if (!imageData) return;

        setIsAnalyzing(true);
        setProgress(0);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const width = imageData.width;
        const height = imageData.height;

        const maxDimension = 1000;
        let scale = 1;
        if (width > maxDimension || height > maxDimension) {
            scale = maxDimension / Math.max(width, height);
        }

        canvas.width = width * scale;
        canvas.height = height * scale;
        ctx.drawImage(imageData, 0, 0, canvas.width, canvas.height);

        const sampleEvery = 5;
        const totalPixels = Math.ceil((canvas.width * canvas.height) / (sampleEvery * sampleEvery));
        let pixelsAnalyzed = 0;

        const colorMap = new Map();
        const overallCmyk = { c: 0, m: 0, y: 0, k: 0 };

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = 1;
        tempCanvas.height = 1;

        for (let x = 0; x < canvas.width; x += sampleEvery) {
            for (let y = 0; y < canvas.height; y += sampleEvery) {
                const pixelData = ctx.getImageData(x, y, 1, 1).data;
                const r = pixelData[0];
                const g = pixelData[1];
                const b = pixelData[2];
                const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;

                tempCtx.fillStyle = `rgb(${r},${g},${b})`;
                tempCtx.fillRect(0, 0, 1, 1);
                const pixel = tempCtx.getImageData(0, 0, 1, 1).data;
                const [c, m, yVal, k] = convert.rgb.cmyk([pixel[0], pixel[1], pixel[2]]);

                overallCmyk.c += c;
                overallCmyk.m += m;
                overallCmyk.y += yVal;
                overallCmyk.k += k;

                let foundSimilar = false;
                for (const [existingHex] of colorMap) {
                    if (colorDistance(hex, existingHex) < 15) {
                        colorMap.set(existingHex, colorMap.get(existingHex) + 1);
                        foundSimilar = true;
                        break;
                    }
                }
                if (!foundSimilar) {
                    colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
                }

                pixelsAnalyzed++;
                if (pixelsAnalyzed % 1000 === 0) {
                    setProgress(Math.round((pixelsAnalyzed / totalPixels) * 100));
                }
            }
        }

        const totalSamples = pixelsAnalyzed;
        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([hex, count]) => ({
                hex,
                count,
                percentage: (count / totalSamples) * 100,
                cmyk: convert.rgb.cmyk(hexToRgb(hex))
            }));

        const overallPercentages = {
            cyan: (overallCmyk.c / totalSamples),
            magenta: (overallCmyk.m / totalSamples),
            yellow: (overallCmyk.y / totalSamples),
            black: (overallCmyk.k / totalSamples)
        };

        setColorStats({
            colors: sortedColors,
            overallCmyk: overallPercentages,
            totalPixels: totalSamples,
            canvasData: { canvas, ctx, width: canvas.width, height: canvas.height }
        });
        setIsAnalyzing(false);
    };

    const renderChannelPreview = (channel) => {
        if (!imageData || !colorStats) return null;

        const channelCanvas = document.createElement('canvas');
        channelCanvas.width = colorStats.canvasData.width;
        channelCanvas.height = colorStats.canvasData.height;
        const channelCtx = channelCanvas.getContext('2d');

        const imageDataCopy = colorStats.canvasData.ctx.getImageData(
            0, 0,
            colorStats.canvasData.width,
            colorStats.canvasData.height
        );

        for (let i = 0; i < imageDataCopy.data.length; i += 4) {
            const [r, g, b] = [
                imageDataCopy.data[i],
                imageDataCopy.data[i+1],
                imageDataCopy.data[i+2]
            ];
            const [c, m, y, k] = convert.rgb.cmyk([r, g, b]);

            const [newR, newG, newB] = convert.cmyk.rgb([
                channel === 'cyan' ? c : 0,
                channel === 'magenta' ? m : 0,
                channel === 'yellow' ? y : 0,
                channel === 'black' ? k : 0
            ]);

            imageDataCopy.data[i] = newR;
            imageDataCopy.data[i+1] = newG;
            imageDataCopy.data[i+2] = newB;
        }

        channelCtx.putImageData(imageDataCopy, 0, 0);
        return channelCanvas.toDataURL();
    };

    // Helper functions
    const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return [r, g, b];
    };

    const colorDistance = (hex1, hex2) => {
        const [r1, g1, b1] = hexToRgb(hex1);
        const [r2, g2, b2] = hexToRgb(hex2);
        return Math.sqrt(
            Math.pow(r2 - r1, 2) +
            Math.pow(g2 - g1, 2) +
            Math.pow(b2 - b1, 2)
        );
    };

    const getContrastColor = (hexColor) => {
        const [r, g, b] = hexToRgb(hexColor);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? '#000' : '#fff';
    };

    const getCmykLabelColor = () => '#fff';

    const getChannelColor = (channel, light = false) => {
        switch(channel) {
            case 'cyan': return light ? '#e0f7fa' : '#00bcd4';
            case 'magenta': return light ? '#fce4ec' : '#e91e63';
            case 'yellow': return light ? '#fff9c4' : '#ffeb3b';
            case 'black': return light ? '#424242' : '#000000';
            default: return '#999';
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minHeight: '100vh',
            padding: '40px 20px',
            background: '#000',
            fontFamily: '"Helvetica Neue", Arial, sans-serif',
            color: '#fff'
        }}>
            <div style={{
                maxWidth: '1400px',
                width: '100%',
                backgroundColor: 'rgba(30, 30, 30, 0.9)',
                borderRadius: '16px',
                padding: '40px',
                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
                <h1 style={{
                    marginBottom: '40px',
                    color: '#fff',
                    fontSize: '2.5rem',
                    fontWeight: '300',
                    letterSpacing: '1px',
                    textAlign: 'center',
                    textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }}>
                    Image Color Analyzer
                </h1>

                {!imageData && (
                    <div {...getRootProps()} style={{
                        border: '2px dashed rgba(255, 255, 255, 0.3)',
                        borderRadius: '12px',
                        padding: '60px 40px',
                        cursor: 'pointer',
                        backgroundColor: isDragActive ? 'rgba(50, 50, 50, 0.7)' : 'rgba(40, 40, 40, 0.7)',
                        width: '500px',
                        maxWidth: '100%',
                        margin: '0 auto',
                        transition: 'all 0.3s ease',
                        textAlign: 'center',
                        ':hover': {
                            borderColor: 'rgba(255, 255, 255, 0.5)',
                            backgroundColor: 'rgba(60, 60, 60, 0.7)'
                        }
                    }}>
                        <input {...getInputProps()} />
                        <p style={{
                            color: '#aaa',
                            fontSize: '1.1rem',
                            margin: 0
                        }}>
                            {isDragActive ? 'Drop the image here' : 'Drag & drop an image here, or click to select'}
                        </p>
                        <p style={{
                            color: '#777',
                            fontSize: '0.9rem',
                            margin: '10px 0 0 0'
                        }}>
                            Supported formats: JPEG, PNG, WEBP
                        </p>
                    </div>
                )}

                {imageData && !colorStats && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '30px'
                    }}>
                        <img
                            src={imageData.src}
                            alt="Preview"
                            style={{
                                maxWidth: '400px',
                                maxHeight: '400px',
                                borderRadius: '12px',
                                boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '15px' }}>
                            <button
                                onClick={analyzeImage}
                                disabled={isAnalyzing}
                                style={{
                                    padding: '15px 30px',
                                    backgroundColor: isAnalyzing ? '#555' : '#2ecc71',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    fontWeight: '500',
                                    width: '220px',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                                    ':hover': {
                                        transform: !isAnalyzing ? 'translateY(-2px)' : 'none',
                                        boxShadow: !isAnalyzing ? '0 6px 10px rgba(0,0,0,0.4)' : 'none'
                                    }
                                }}
                            >
                                {isAnalyzing ? `Analyzing... ${progress}%` : 'Analyze Colors'}
                            </button>
                            <button
                                onClick={resetImage}
                                style={{
                                    padding: '15px 30px',
                                    backgroundColor: '#e74c3c',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    fontWeight: '500',
                                    width: '220px',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                                    ':hover': {
                                        transform: 'translateY(-2px)',
                                        boxShadow: '0 6px 10px rgba(0,0,0,0.4)'
                                    }
                                }}
                            >
                                Upload New Image
                            </button>
                        </div>
                    </div>
                )}

                {colorStats && (
                    <>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'flex-start',
                            gap: '30px',
                            width: '100%',
                            marginBottom: '50px',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{
                                width: '280px',
                                backgroundColor: 'rgba(40, 40, 40, 0.8)',
                                borderRadius: '12px',
                                padding: '20px',
                                boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <img
                                    src={imageData.src}
                                    alt="Preview"
                                    style={{
                                        width: '100%',
                                        borderRadius: '8px',
                                        marginBottom: '20px',
                                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                                    }}
                                />
                                <div>
                                    <h3 style={{
                                        marginTop: 0,
                                        color: '#fff',
                                        fontWeight: '400',
                                        borderBottom: '1px solid #444',
                                        paddingBottom: '10px'
                                    }}>
                                        Overall CMYK Composition
                                    </h3>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: '10px'
                                    }}>
                                        <div>
                                            <p style={{
                                                margin: '8px 0',
                                                color: '#00bcd4',
                                                fontWeight: '500'
                                            }}>
                                                Cyan: <span style={{ color: '#fff' }}>{colorStats.overallCmyk.cyan.toFixed(1)}%</span>
                                            </p>
                                            <p style={{
                                                margin: '8px 0',
                                                color: '#e91e63',
                                                fontWeight: '500'
                                            }}>
                                                Magenta: <span style={{ color: '#fff' }}>{colorStats.overallCmyk.magenta.toFixed(1)}%</span>
                                            </p>
                                        </div>
                                        <div>
                                            <p style={{
                                                margin: '8px 0',
                                                color: '#ffeb3b',
                                                fontWeight: '500'
                                            }}>
                                                Yellow: <span style={{ color: '#fff' }}>{colorStats.overallCmyk.yellow.toFixed(1)}%</span>
                                            </p>
                                            <p style={{
                                                margin: '8px 0',
                                                color: '#fff',
                                                fontWeight: '500'
                                            }}>
                                                Black: <span style={{ color: '#fff' }}>{colorStats.overallCmyk.black.toFixed(1)}%</span>
                                            </p>
                                        </div>
                                    </div>
                                    <p style={{
                                        fontSize: '0.85em',
                                        color: '#aaa',
                                        marginTop: '15px',
                                        borderTop: '1px solid #444',
                                        paddingTop: '10px'
                                    }}>
                                        {colorStats.totalPixels.toLocaleString()} pixels analyzed
                                    </p>
                                </div>
                            </div>

                            <div style={{
                                width: '500px',
                                height: '500px',
                                backgroundColor: 'rgba(40, 40, 40, 0.8)',
                                borderRadius: '12px',
                                padding: '20px',
                                boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center'
                            }}>
                                <Pie
                                    data={{
                                        labels: ['Cyan', 'Magenta', 'Yellow', 'Black'],
                                        datasets: [{
                                            data: [
                                                colorStats.overallCmyk.cyan,
                                                colorStats.overallCmyk.magenta,
                                                colorStats.overallCmyk.yellow,
                                                colorStats.overallCmyk.black
                                            ],
                                            backgroundColor: [
                                                'rgba(0, 188, 212, 0.9)',
                                                'rgba(233, 30, 99, 0.9)',
                                                'rgba(255, 235, 59, 0.9)',
                                                'rgba(0, 0, 0, 0.9)'
                                            ],
                                            borderWidth: 0,
                                            hoverBorderWidth: 1
                                        }]
                                    }}
                                    options={{
                                        plugins: {
                                            legend: {
                                                position: 'right',
                                                labels: {
                                                    font: {
                                                        size: 14,
                                                        family: '"Helvetica Neue", Arial, sans-serif',
                                                        color: '#fff'
                                                    },
                                                    padding: 20,
                                                    usePointStyle: true,
                                                    pointStyle: 'circle'
                                                }
                                            },
                                            datalabels: {
                                                formatter: (value) => `${value.toFixed(1)}%`,
                                                color: () => '#fff',
                                                font: {
                                                    weight: 'bold',
                                                    size: 16,
                                                    family: '"Helvetica Neue", Arial, sans-serif'
                                                }
                                            }
                                        },
                                        cutout: '60%',
                                        maintainAspectRatio: false,
                                        animation: {
                                            animateScale: true,
                                            animateRotate: true
                                        }
                                    }}
                                />
                            </div>

                            <div style={{
                                width: '400px',
                                maxHeight: '500px',
                                overflowY: 'auto',
                                padding: '20px',
                                backgroundColor: 'rgba(40, 40, 40, 0.8)',
                                borderRadius: '12px',
                                boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <h2 style={{
                                    marginTop: 0,
                                    marginBottom: '20px',
                                    color: '#fff',
                                    fontWeight: '400',
                                    fontSize: '1.3rem'
                                }}>
                                    Top Colors ({colorStats.colors.length})
                                </h2>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                                    gap: '12px'
                                }}>
                                    {colorStats.colors.slice(0, 50).map((color, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                height: '80px',
                                                backgroundColor: color.hex,
                                                borderRadius: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                color: getContrastColor(color.hex),
                                                fontSize: '0.8em',
                                                position: 'relative',
                                                transition: 'transform 0.2s ease',
                                                boxShadow: '0 3px 6px rgba(0,0,0,0.3)',
                                                ':hover': {
                                                    transform: 'scale(1.05)',
                                                    zIndex: 1,
                                                    boxShadow: '0 5px 15px rgba(0,0,0,0.5)'
                                                }
                                            }}
                                        >
                                            <span style={{
                                                fontWeight: 'bold',
                                                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                                            }}>
                                                {color.percentage.toFixed(1)}%
                                            </span>
                                            <div style={{
                                                position: 'absolute',
                                                bottom: '5px',
                                                fontSize: '0.7em',
                                                backgroundColor: 'rgba(0,0,0,0.6)',
                                                padding: '2px 5px',
                                                borderRadius: '3px',
                                                textShadow: '0 1px 1px rgba(0,0,0,0.5)'
                                            }}>
                                                {color.hex}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* COMPONENT VIEW TOOLS - Final compact version */}
                        <div style={{
                            width: 'calc(100% - 40px)',
                            backgroundColor: 'rgba(40, 40, 40, 0.8)',
                            borderRadius: '12px',
                            padding: '20px',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            marginBottom: '30px',
                            marginLeft: '20px',
                            marginRight: '20px'
                        }}>
                            <h2 style={{
                                marginTop: 0,
                                marginBottom: '20px',
                                color: '#fff',
                                fontWeight: '400',
                                fontSize: '1.3rem',
                                textAlign: 'center'
                            }}>
                                Channel Isolation Tools
                            </h2>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                gap: '12px',
                                maxWidth: '100%'
                            }}>
                                {['cyan', 'magenta', 'yellow', 'black'].map((channel) => (
                                    <div key={channel} style={{
                                        padding: '12px',
                                        border: `1px solid ${getChannelColor(channel)}`,
                                        borderRadius: '8px',
                                        backgroundColor: activeChannel === channel ? `${getChannelColor(channel, true)}` : 'rgba(50, 50, 50, 0.8)',
                                        transition: 'all 0.3s ease'
                                    }}>
                                        <h3 style={{
                                            margin: '0 0 8px 0',
                                            color: getChannelColor(channel),
                                            fontSize: '0.95rem',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }}>
                                            <span style={{
                                                display: 'inline-block',
                                                width: '8px',
                                                height: '8px',
                                                backgroundColor: getChannelColor(channel),
                                                borderRadius: '50%'
                                            }}></span>
                                            {channel.charAt(0).toUpperCase() + channel.slice(1)}
                                        </h3>
                                        <p style={{
                                            margin: '0 0 8px 0',
                                            color: '#aaa',
                                            fontSize: '0.8rem'
                                        }}>
                                            View {channel} channel
                                        </p>
                                        <button
                                            onClick={() => setActiveChannel(activeChannel === channel ? null : channel)}
                                            style={{
                                                width: '100%',
                                                padding: '8px',
                                                backgroundColor: activeChannel === channel ? getChannelColor(channel) : 'rgba(60, 60, 60, 0.9)',
                                                color: activeChannel === channel ? '#fff' : getChannelColor(channel),
                                                border: `1px solid ${getChannelColor(channel)}`,
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                fontWeight: '500',
                                                transition: 'all 0.3s ease'
                                            }}
                                        >
                                            {activeChannel === channel ? 'Hide' : 'Show'}
                                        </button>
                                        {activeChannel === channel && (
                                            <div style={{
                                                marginTop: '8px',
                                                borderRadius: '6px',
                                                overflow: 'hidden'
                                            }}>
                                                <img
                                                    src={renderChannelPreview(channel)}
                                                    alt={`${channel} channel`}
                                                    style={{
                                                        width: '100%',
                                                        display: 'block'
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ textAlign: 'center' }}>
                            <button
                                onClick={resetImage}
                                style={{
                                    padding: '12px 30px',
                                    backgroundColor: '#3498db',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    fontWeight: '500',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                                    ':hover': {
                                        backgroundColor: '#2980b9',
                                        transform: 'translateY(-2px)',
                                        boxShadow: '0 6px 12px rgba(0,0,0,0.4)'
                                    }
                                }}
                            >
                                Upload New Image
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
