const path = require('path');
const webpack = require('webpack');

// Plugins
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const ScratchWebpackConfigBuilder = require('scratch-webpack-configuration');

const commonHtmlWebpackPluginOptions = {
    gtm_id: process.env.GTM_ID || '',
    gtm_env_auth: process.env.GTM_ENV_AUTH || ''
};

// Google Drive save/load settings. Override at build time with DRIVE_CLIENT_ID / DRIVE_MASTER_FOLDER_ID;
// the defaults are the school's current OAuth client and "Scratch Submissions" folder.
const DEFAULT_DRIVE_CLIENT_ID = '616910740159-olchtcld2rmak1ejrf216jf9tc51fg6q.apps.googleusercontent.com';
const DEFAULT_DRIVE_MASTER_FOLDER_ID = '1df1klgPC4GxBgUuIZ0SP6Uq2-BOPS1tv';

const baseConfig = new ScratchWebpackConfigBuilder(
    {
        rootPath: path.resolve(__dirname),
        enableReact: true,
        shouldSplitChunks: false,
        publicPath: ''
    })
    .setTarget('browserslist')
    .merge({
        output: {
            assetModuleFilename: 'static/assets/[name].[hash][ext][query]',
            filename: '[name].js',
            chunkFilename: 'chunks/[name].[chunkhash].js',
            publicPath: '/',
            globalObject: 'this',
            library: {
                name: 'GUI',
                type: 'umd2'
            }
        },
        resolve: {
            fallback: {
                Buffer: require.resolve('buffer/'),
                stream: require.resolve('stream-browserify')
            }
        }
    })
    .addModuleRule({
        test: /\.(svg|png|wav|mp3|gif|jpg)$/,
        resourceQuery: /^$/, // reject any query string
        type: 'asset' // let webpack decide on the best type of asset
    })
    .addPlugin(new webpack.DefinePlugin({
        'process.env.DEBUG': Boolean(process.env.DEBUG),
        'process.env.DRIVE_CLIENT_ID': JSON.stringify(process.env.DRIVE_CLIENT_ID || DEFAULT_DRIVE_CLIENT_ID),
        'process.env.DRIVE_MASTER_FOLDER_ID': JSON.stringify(
            process.env.DRIVE_MASTER_FOLDER_ID || DEFAULT_DRIVE_MASTER_FOLDER_ID
        ),
        'process.env.GA_ID': `"${process.env.GA_ID || 'UA-000000-01'}"`,
        'process.env.GTM_ENV_AUTH': `"${process.env.GTM_ENV_AUTH || ''}"`,
        'process.env.GTM_ID': process.env.GTM_ID ? `"${process.env.GTM_ID}"` : null
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: 'node_modules/scratch-blocks/media',
                to: 'static/blocks-media/default'
            },
            {
                from: 'node_modules/scratch-blocks/media',
                to: 'static/blocks-media/high-contrast'
            },
            {
                from: 'src/lib/themes/high-contrast/blocks-media',
                to: 'static/blocks-media/high-contrast',
                force: true
            },
            {
                // scratch-vm loads extensions in a worker from this file at the site root
                context: 'node_modules/scratch-vm/dist/web',
                from: 'extension-worker.{js,js.map}',
                noErrorOnMissing: true
            },
            {
                // scratch-storage's prebuilt bundle loads its asset-fetching worker from /chunks/fetch-worker.<hash>.js
                context: 'node_modules/scratch-storage/dist/web/chunks',
                from: 'fetch-worker.*.js{,.map}',
                to: 'chunks'
            }
        ]
    }));

if (!process.env.CI) {
    baseConfig.addPlugin(new webpack.ProgressPlugin());
}

// build the shipping library in `dist/`
const distConfig = baseConfig.clone()
    .merge({
        entry: {
            'scratch-gui': path.join(__dirname, 'src/index.js')
        },
        output: {
            path: path.resolve(__dirname, 'dist')
        }
    })
    .addExternals(['react', 'react-dom'])
    .addPlugin(
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/lib/libraries/*.json',
                    to: 'libraries',
                    flatten: true
                }
            ]
        })
    );

// build the examples and debugging tools in `build/`
const buildConfig = baseConfig.clone()
    .enableDevServer(process.env.PORT || 8601)
    .merge({
        entry: {
            gui: './src/playground/index.jsx',
            blocksonly: './src/playground/blocks-only.jsx',
            compatibilitytesting: './src/playground/compatibility-testing.jsx',
            player: './src/playground/player.jsx'
        },
        output: {
            path: path.resolve(__dirname, 'build')
        }
    })
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['gui'],
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['blocksonly'],
        filename: 'blocks-only.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Blocks Only Example'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['compatibilitytesting'],
        filename: 'compatibility-testing.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Compatibility Testing'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['player'],
        filename: 'player.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Player Example'
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: 'static',
                to: 'static',
                globOptions: {
                    ignore: ['**/_routes.json']
                }
            },
            {
                // Cloudflare Pages only reads _routes.json from the root of the build output
                from: 'static/_routes.json',
                to: '_routes.json'
            },
            {
                from: 'extensions/**',
                to: 'static',
                context: 'src/examples'
            }
        ]
    }));

const buildDist = process.env.NODE_ENV === 'production' || process.env.BUILD_MODE === 'dist';

module.exports = buildDist ?
    [buildConfig.get(), distConfig.get()] :
    buildConfig.get();
