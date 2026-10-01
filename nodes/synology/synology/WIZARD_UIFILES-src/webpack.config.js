const path = require('path');
const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = {
  mode: 'production',
  devtool: false,
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
  },
  entry: {
    executor_install: './src/install-entry.js',
  },
  output: {
    library: {
      name: 'SYNO.SDS.PkgManApp.Custom.JsonpLoader.load',
      type: 'jsonp',
    },
    path: path.join(__dirname, 'dist'),
    filename: '[name].bundle.js',
  },
  plugins: [
    new VueLoaderPlugin(),
  ],
  externalsType: 'window',
  externals: {
    vue: 'Vue',
  },
  optimization: {
    minimize: true,
  },
};
