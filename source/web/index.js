import createXAtlasModule from "./build/xatlas.js"
import { expose } from "comlink";

let _onLoad = () => { } //  we cannot put it in the object, otherwise we cannot access it from the outside
export class XAtlasAPI {

    /**
     * @param onLoad {Function}
     * @param locateFile {Function} - should return path for xatlas_web.wasm, default is root of domain
     * @param onAtlasProgress {Function} - called on progress update with mode {ProgressCategory} and counter
     */
    constructor(onLoad, locateFile, onAtlasProgress) {
        this.xatlas = null;
        this.loaded = false;
        _onLoad = onLoad || (() => { });
        this.atlasCreated = false;
        /**
         * @type {{meshId: number, vertices: Float32Array, normals: Float32Array|null, coords: Float32Array|null, meshObj: any}[]}
         */
        this.meshes = [];
        this.uvmeshes = [];
        let params = {};
        if (onAtlasProgress) params = { ...params, onAtlasProgress };
        const ctor = (loc) => {
            params = {
                ...params, locateFile: ((path, dir) => {
                    return ((loc && path === "xatlas.wasm") ? loc : dir + path)
                })
            };
            createXAtlasModule(params).then(m => { this.moduleLoaded(m) });
        }
        if (locateFile) {
            let pp = locateFile("xatlas.wasm", "");
            if (pp && pp.then) pp.then(ctor);
            else ctor(pp);
        } else ctor()
    }

    moduleLoaded(mod) {
        this.xatlas = mod;
        this.loaded = true;
        if (_onLoad) _onLoad();
    }

    createAtlas() {
        this.xatlas.createAtlas();
        this.meshes = [];
        this.atlasCreated = true;
    }
    /**
        * @param vertexCount
        * @param indexCount
        * @param normals
        * @param coords
        * @return {{meshId: number, indexOffset: number, positionOffset: number, normalOffset: number, uvOffset: number, meshObj: any}}
        */
    createMesh(vertexCount, indexCount, normals, coords) {
        return this.xatlas.createMesh(vertexCount, indexCount, normals, coords);
    }
    /**
     *
     * @param indexes {Uint16Array}
     * @param vertices {Float32Array}
     * @param normals {Float32Array}
     * @param uvs {Float32Array}
     * @param meshObj {any}
     * @param useNormals {boolean}
     * @param useUVs {boolean}
     * @return {null | {indexes: (Float32Array | null), vertices: Float32Array, normals: (Float32Array | null), meshId: number, uv1: (Float32Array | null), meshObj: any}}
     */
    addMesh(indexes, vertices, normals, uvs, meshObj, useNormals = false, useUVs = false) {
        if (!this.loaded || !this.atlasCreated) throw "Create atlas first";
        let meshDesc = this.xatlas.createMesh(vertices.length / 3, indexes.length, normals != null && useNormals, uvs != null && useUVs);
        this.xatlas.HEAPU16.set(indexes, meshDesc.indexOffset / 2);
        let vs = new Float32Array([...vertices]);
        this.xatlas.HEAPF32.set(vs, meshDesc.positionOffset / 4);
        if (normals != null && useNormals) this.xatlas.HEAPF32.set(normals, meshDesc.normalOffset / 4);
        if (uvs != null && useUVs) this.xatlas.HEAPF32.set(uvs, meshDesc.uvOffset / 4);
        let addMeshRes = this.xatlas.addMesh();
        if (addMeshRes !== 0) {
            console.log("Error adding mesh: ", addMeshRes);
            return null;
        }
        let ret = {
            meshId: meshDesc.meshId,
            meshObj: meshObj,
            vertices: vertices,
            normals: normals || null,
            indexes: indexes || null,
            uvs: uvs || null,
        };
        this.meshes.push(ret);
        return ret;
    }

    /**
     * Result in uvs2
     * @param chartOptions {{maxIterations: number, straightnessWeight: number, textureSeamWeight: number, maxChartArea: number, normalDeviationWeight: number, roundnessWeight: number, maxCost: number, maxBoundaryLength: number, normalSeamWeight: number}}
     * @param packOptions {{maxChartSize: number, padding: number, bilinear: boolean, createImage: boolean, blockAlign: boolean, resolution: number, bruteForce: boolean, texelsPerUnit: number}}
     * @param returnMeshes {boolean} - default = true
     * @return {{vertices: Float32Array, uvs2: Float32Array, normals?: Float32Array, uvs?: Float32Array, index: Uint16Array, mesh: any}[]}
     */
    generateAtlas(chartOptions, packOptions, returnMeshes = true) {
        if (!this.loaded || !this.atlasCreated) throw "Create atlas first";
        if (this.meshes.length < 1) throw "Add meshes first";
        chartOptions = { ...this.defaultChartOptions(), ...chartOptions };
        packOptions = { ...this.defaultPackOptions(), ...packOptions };
        this.xatlas.generateAtlas(chartOptions, packOptions);
        if (!returnMeshes) return [];
        let returnVal = [];
        for (let { meshId, meshObj, vertices, normals, indexes, uvs } of this.meshes) {
            let ret = this.getMeshData(meshId);
            let index = new Uint16Array(this.xatlas.HEAPU32.subarray(ret.indexOffset / 4, ret.indexOffset / 4 + ret.newIndexCount));
            let oldIndexes = new Uint16Array(this.xatlas.HEAPU32.subarray(ret.originalIndexOffset / 4, ret.originalIndexOffset / 4 + ret.newVertexCount));
            let xcoords = new Float32Array(this.xatlas.HEAPF32.subarray(ret.uvOffset / 4, ret.uvOffset / 4 + ret.newVertexCount * 2));
            this.xatlas.destroyMeshData(ret);
            const newVertices = new Float32Array(ret.newVertexCount * 3);
            let newNormals;
            let newUVs;
            const uvs2 = xcoords;
            if (normals) {
                newNormals = new Float32Array(ret.newVertexCount * 3);
            }
            if (uvs) {
                newUVs = new Float32Array(ret.newVertexCount * 2);
            }
            for (let i = 0, l = ret.newVertexCount; i < l; i++) {
                let oldIndex = oldIndexes[i];
                newVertices[3 * i + 0] = vertices[3 * oldIndex + 0];
                newVertices[3 * i + 1] = vertices[3 * oldIndex + 1];
                newVertices[3 * i + 2] = vertices[3 * oldIndex + 2];
                if (newNormals) {
                    newNormals[3 * i + 0] = normals[3 * oldIndex + 0];
                    newNormals[3 * i + 1] = normals[3 * oldIndex + 1];
                    newNormals[3 * i + 2] = normals[3 * oldIndex + 2];
                }
                if (newUVs) {
                    newUVs[2 * i + 0] = uvs[2 * oldIndex + 0];
                    newUVs[2 * i + 1] = uvs[2 * oldIndex + 1];
                }
            }
            returnVal.push({
                index: index,
                vertices: newVertices,
                normals: newNormals,
                uvs: newUVs,
                uvs2,
                mesh: meshObj,
                vertexCount: ret.newVertexCount,
                oldIndexes: oldIndexes
            });
        }
        return returnVal;
    }
    /**
     * @param vertexCount
     * @param indexCount
     * @return {{meshId: number, indexOffset: number, uvOffset: number, meshObj: any}}
     */
    createUvMesh(vertexCount, indexCount) {
        return this.xatlas.createUvMesh(vertexCount, indexCount);
    }
    addUvMesh(indexes, vertices, normals, uvs, uvs2, meshObj) {
        if (!this.loaded || !this.atlasCreated) throw "Create atlas first";
        let meshUvDesc = this.xatlas.createUvMesh(vertices.length / 3, indexes.length);
        this.xatlas.HEAPU16.set(indexes, meshUvDesc.indexOffset / 2);
        this.xatlas.HEAPF32.set(uvs2, meshUvDesc.uvOffset / 4);

        let addMeshRes = this.xatlas.addUvMesh();
        // this.xatlas._free(meshDesc.indexOffset); // should be done on c++ side
        // this.xatlas._free(meshDesc.positionOffset);
        if (addMeshRes !== 0) {
            console.log("Error adding uv mesh: ", addMeshRes);
            return null;
        }
        let ret = {
            meshId: meshUvDesc.meshId,
            meshObj: meshObj,
            indexes: indexes || null,
            uvs2: uvs2 || null,
            vertices: vertices || null,
            normals: normals || null,
            uvs: uvs || null,
        };
        this.uvmeshes.push(ret);
        return ret;
    }
    /**
         * Result in coords1, input coords in coords
         * @param chartOptions {{maxIterations: number, straightnessWeight: number, textureSeamWeight: number, maxChartArea: number, normalDeviationWeight: number, roundnessWeight: number, maxCost: number, maxBoundaryLength: number, normalSeamWeight: number}}
         * @param packOptions {{maxChartSize: number, padding: number, bilinear: boolean, createImage: boolean, blockAlign: boolean, resolution: number, bruteForce: boolean, texelsPerUnit: number}}
         * @param returnMeshes {boolean} - default = true
         * @return {{vertices: Float32Array, uvs2: Float32Array, normals?: Float32Array, uvs?: Float32Array, index: Uint16Array, mesh: any}[]}
         */
    packAtlas(chartOptions, packOptions, returnMeshes = true) {
        if (!this.loaded || !this.atlasCreated) throw "Create atlas first";
        if (this.uvmeshes.length < 1) throw "Add meshes first";
        chartOptions = { ...this.defaultChartOptions(), ...chartOptions };
        packOptions = { ...this.defaultPackOptions(), ...packOptions };
        this.xatlas.computeCharts(chartOptions);
        this.xatlas.packCharts(packOptions);
        if (!returnMeshes) return [];
        let returnVal = [];
        for (let { meshId, meshObj, vertices, normals, uvs, indexes } of this.uvmeshes) {
            let ret = this.getMeshData(meshId);
            let index = new Uint16Array(this.xatlas.HEAPU32.subarray(ret.indexOffset / 4, ret.indexOffset / 4 + ret.newIndexCount));
            let oldIndexes = new Uint16Array(this.xatlas.HEAPU32.subarray(ret.originalIndexOffset / 4, ret.originalIndexOffset / 4 + ret.newVertexCount));
            let xcoords = new Float32Array(this.xatlas.HEAPF32.subarray(ret.uvOffset / 4, ret.uvOffset / 4 + ret.newVertexCount * 2));
            this.xatlas.destroyMeshData(ret);
            if (meshId === '4' || meshId === 4) {
                console.log('packAtlas', meshId);
                console.log('ret', ret);
                console.log('index', index);
                console.log('oldIndexes', oldIndexes);
                console.log('oldIndex Sent', indexes);
            }
            const newVertices = new Float32Array(ret.newVertexCount * 3);
            let newNormals;
            let newUVs;
            const uvs2 = xcoords;
            if (normals) {
                newNormals = new Float32Array(ret.newVertexCount * 3);
            }
            if (uvs) {
                newUVs = new Float32Array(ret.newVertexCount * 2);
            }
            for (let i = 0, l = ret.newVertexCount; i < l; i++) {
                let oldIndex = oldIndexes[i];
                newVertices[3 * i + 0] = vertices[3 * oldIndex + 0];
                newVertices[3 * i + 1] = vertices[3 * oldIndex + 1];
                newVertices[3 * i + 2] = vertices[3 * oldIndex + 2];
                if (newNormals) {
                    newNormals[3 * i + 0] = normals[3 * oldIndex + 0];
                    newNormals[3 * i + 1] = normals[3 * oldIndex + 1];
                    newNormals[3 * i + 2] = normals[3 * oldIndex + 2];
                }
                if (newUVs) {
                    newUVs[2 * i + 0] = uvs[2 * oldIndex + 0];
                    newUVs[2 * i + 1] = uvs[2 * oldIndex + 1];
                }
            }
            returnVal.push({
                index: index,
                vertices: newVertices,
                normals: newNormals,
                uvs: newUVs,
                uvs2,
                mesh: meshObj,
                vertexCount: ret.newVertexCount,
                oldIndexes: oldIndexes
            });
        }
        return returnVal;
    }
    defaultChartOptions() {
        return {
            fixWinding: false,
            maxBoundaryLength: 0,
            maxChartArea: 0,
            maxCost: 2,
            maxIterations: 1,
            normalDeviationWeight: 2,
            normalSeamWeight: 4,
            roundnessWeight: 0.009999999776482582,
            straightnessWeight: 6,
            textureSeamWeight: 0.5,
            useInputMeshUvs: false,
        };
    }

    defaultPackOptions() {
        return {
            bilinear: true,
            blockAlign: false,
            bruteForce: false,
            createImage: false,
            maxChartSize: 0,
            padding: 0,
            resolution: 0,
            rotateCharts: true,
            rotateChartsToAxis: true,
            texelsPerUnit: 0
        };
    }

    setProgressLogging(flag) {
        this.xatlas.setProgressLogging(flag);
    }

    /**
     * @param meshId
     * @return {{newVertexCount: number, newIndexCount: number, indexOffset: number, originalIndexOffset: number, uvOffset: number}}
     */
    getMeshData(meshId) {
        return this.xatlas.getMeshData(meshId);
    }

    /**
     * @param data {{newVertexCount: number, newIndexCount: number, indexOffset: number, originalIndexOffset: number, uvOffset: number}}
     * @return {*}
     */
    destroyMeshData(data) {
        this.xatlas.destroyMeshData(data);
    }

    destroyAtlas() {
        this.atlasCreated = false;
        this.xatlas.destroyAtlas();
        this.meshes = [];
        this.xatlas.doLeakCheck();
    }

}

expose(XAtlasAPI);
