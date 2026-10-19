# hydraulics
## Description:
This folder includes subfolders, each corresponding to an individual model-unit containing the HEC-RAS model used for the conformance phase of modeling.

Models should include all relevant files required to simulate the model on desktop. This includes all model files with *.X01 extensions (e.g. .p01, .p01.hdf, .g01, .u01, etc.). Associated land-use/cover files should also be included.

Note that terrain files are not to be stored in this directory, they are located in:
> ffrd-basin > terrain-modeling


### model-unit folder
Includes current model results for the *conformance* phase, as improved from the *calibration* phase.

### archive folder
The *"archive"* folder is used to house draft and outdated model versions as updates are made. Archived models should be date stamped. Examples of an archived model unit directory name:
> model-unit-YYYYMMDD
> kickapoo-20250314