# openSenseMap API Changelog

## Unreleased
- Include sensorId as default column in measurements download
- Add format parameter to bulk download and descriptive statistics routes
- Support json format in bulk download route
- Support json and tidy csv format in descriptive statistics route
- Use @sensebox/opensensemap-api-models v0.0.9

## v3
- Avoid moment usage in ClassifyTransformer
- Use @sensebox/opensensemap-api-models v0.0.8

## v2
- Initial Release after splitting api and models
- add transformer for classifying the state of boxes
- Add descriptive statistics measurements transformer
- Add descriptive statistics route
- Move Measurements outlier detection into this package
- Use lorenwest/config for configuration
- Do stringification in this package instead of models package
- Expand tests
- Do logging in json format and not to folder
- Parse timestamps as RFC3339
- See https://github.com/sensebox/openSenseMap-API/pull/132