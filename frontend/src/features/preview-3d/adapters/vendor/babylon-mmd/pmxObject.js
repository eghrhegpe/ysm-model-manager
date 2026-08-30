export var PmxObject;
(function (PmxObject) {
    let Header;
    (function (Header) {
        /**
         * Encoding of the PMX file
         */
        let Encoding;
        (function (Encoding) {
            Encoding[Encoding["Utf16le"] = 0] = "Utf16le";
            Encoding[Encoding["Utf8"] = 1] = "Utf8";
            Encoding[Encoding["ShiftJis"] = 2] = "ShiftJis"; // for pmd compatibility
        })(Encoding = Header.Encoding || (Header.Encoding = {}));
    })(Header = PmxObject.Header || (PmxObject.Header = {}));
    let Vertex;
    (function (Vertex) {
        /**
         * Weight type of the vertex
         */
        let BoneWeightType;
        (function (BoneWeightType) {
            BoneWeightType[BoneWeightType["Bdef1"] = 0] = "Bdef1";
            BoneWeightType[BoneWeightType["Bdef2"] = 1] = "Bdef2";
            BoneWeightType[BoneWeightType["Bdef4"] = 2] = "Bdef4";
            BoneWeightType[BoneWeightType["Sdef"] = 3] = "Sdef";
            BoneWeightType[BoneWeightType["Qdef"] = 4] = "Qdef"; // pmx 2.1 spec (which is not supported by mmd)
        })(BoneWeightType = Vertex.BoneWeightType || (Vertex.BoneWeightType = {}));
    })(Vertex = PmxObject.Vertex || (PmxObject.Vertex = {}));
    let Material;
    (function (Material) {
        /**
         * Flag of the material
         */
        let Flag;
        (function (Flag) {
            Flag[Flag["IsDoubleSided"] = 1] = "IsDoubleSided";
            Flag[Flag["EnabledGroundShadow"] = 2] = "EnabledGroundShadow";
            Flag[Flag["EnabledDrawShadow"] = 4] = "EnabledDrawShadow";
            Flag[Flag["EnabledReceiveShadow"] = 8] = "EnabledReceiveShadow";
            Flag[Flag["EnabledToonEdge"] = 16] = "EnabledToonEdge";
            Flag[Flag["EnabledVertexColor"] = 32] = "EnabledVertexColor";
            Flag[Flag["EnabledPointDraw"] = 64] = "EnabledPointDraw";
            Flag[Flag["EnabledLineDraw"] = 128] = "EnabledLineDraw"; // pmx 2.1 spec (which is not supported by mmd)
        })(Flag = Material.Flag || (Material.Flag = {}));
        /**
         * Sphere texture blend mode
         */
        let SphereTextureMode;
        (function (SphereTextureMode) {
            SphereTextureMode[SphereTextureMode["Off"] = 0] = "Off";
            SphereTextureMode[SphereTextureMode["Multiply"] = 1] = "Multiply";
            SphereTextureMode[SphereTextureMode["Add"] = 2] = "Add";
            SphereTextureMode[SphereTextureMode["SubTexture"] = 3] = "SubTexture";
        })(SphereTextureMode = Material.SphereTextureMode || (Material.SphereTextureMode = {}));
    })(Material = PmxObject.Material || (PmxObject.Material = {}));
    let Bone;
    (function (Bone) {
        /**
         * Flag of the bone
         */
        let Flag;
        (function (Flag) {
            Flag[Flag["UseBoneIndexAsTailPosition"] = 1] = "UseBoneIndexAsTailPosition";
            Flag[Flag["IsRotatable"] = 2] = "IsRotatable";
            Flag[Flag["IsMovable"] = 4] = "IsMovable";
            Flag[Flag["IsVisible"] = 8] = "IsVisible";
            Flag[Flag["IsControllable"] = 16] = "IsControllable";
            Flag[Flag["IsIkEnabled"] = 32] = "IsIkEnabled";
            /**
             * Whether to apply Append transform in a chain
             *
             * If this bit is 0, then in a bone structure with chain-append transform applied
             *
             * the append transform works by adding itself to each other's calculation results
             */
            Flag[Flag["LocalAppendTransform"] = 128] = "LocalAppendTransform";
            /**
             * Whether to apply Append transform to rotation
             */
            Flag[Flag["HasAppendRotate"] = 256] = "HasAppendRotate";
            /**
             * Whether to apply Append transform to position
             */
            Flag[Flag["HasAppendMove"] = 512] = "HasAppendMove";
            Flag[Flag["HasAxisLimit"] = 1024] = "HasAxisLimit";
            Flag[Flag["HasLocalVector"] = 2048] = "HasLocalVector";
            /**
             * Whether to apply transform after physics
             *
             * If this bit is 1, the bone transform is applied after physics
             */
            Flag[Flag["TransformAfterPhysics"] = 4096] = "TransformAfterPhysics";
            Flag[Flag["IsExternalParentTransformed"] = 8192] = "IsExternalParentTransformed";
        })(Flag = Bone.Flag || (Bone.Flag = {}));
    })(Bone = PmxObject.Bone || (PmxObject.Bone = {}));
    let Morph;
    (function (Morph) {
        /**
         * Category of the morph
         *
         * It's virtually unnecessary information to implement the runtime
         */
        let Category;
        (function (Category) {
            Category[Category["System"] = 0] = "System";
            Category[Category["Eyebrow"] = 1] = "Eyebrow";
            Category[Category["Eye"] = 2] = "Eye";
            Category[Category["Lip"] = 3] = "Lip";
            Category[Category["Other"] = 4] = "Other";
        })(Category = Morph.Category || (Morph.Category = {}));
        /**
         * Type of the morph
         */
        let Type;
        (function (Type) {
            Type[Type["GroupMorph"] = 0] = "GroupMorph";
            Type[Type["VertexMorph"] = 1] = "VertexMorph";
            Type[Type["BoneMorph"] = 2] = "BoneMorph";
            Type[Type["UvMorph"] = 3] = "UvMorph";
            Type[Type["AdditionalUvMorph1"] = 4] = "AdditionalUvMorph1";
            Type[Type["AdditionalUvMorph2"] = 5] = "AdditionalUvMorph2";
            Type[Type["AdditionalUvMorph3"] = 6] = "AdditionalUvMorph3";
            Type[Type["AdditionalUvMorph4"] = 7] = "AdditionalUvMorph4";
            Type[Type["MaterialMorph"] = 8] = "MaterialMorph";
            Type[Type["FlipMorph"] = 9] = "FlipMorph";
            Type[Type["ImpulseMorph"] = 10] = "ImpulseMorph"; // pmx 2.1 spec (which is not supported by mmd)
        })(Type = Morph.Type || (Morph.Type = {}));
        let MaterialMorph;
        (function (MaterialMorph) {
            /**
             * Morph operation type
             *
             * Multiply: linear interpolation between the original value and the (original value * morph value) by morph ratio
             *
             * Add: original value + (morph value * ratio)
             */
            let Type;
            (function (Type) {
                Type[Type["Multiply"] = 0] = "Multiply";
                Type[Type["Add"] = 1] = "Add";
            })(Type = MaterialMorph.Type || (MaterialMorph.Type = {}));
        })(MaterialMorph = Morph.MaterialMorph || (Morph.MaterialMorph = {}));
    })(Morph = PmxObject.Morph || (PmxObject.Morph = {}));
    let DisplayFrame;
    (function (DisplayFrame) {
        let FrameData;
        (function (FrameData) {
            /**
             * Type of the frame element
             */
            let FrameType;
            (function (FrameType) {
                FrameType[FrameType["Bone"] = 0] = "Bone";
                FrameType[FrameType["Morph"] = 1] = "Morph";
            })(FrameType = FrameData.FrameType || (FrameData.FrameType = {}));
        })(FrameData = DisplayFrame.FrameData || (DisplayFrame.FrameData = {}));
    })(DisplayFrame = PmxObject.DisplayFrame || (PmxObject.DisplayFrame = {}));
    let RigidBody;
    (function (RigidBody) {
        /**
         * Shape type
         */
        let ShapeType;
        (function (ShapeType) {
            ShapeType[ShapeType["Sphere"] = 0] = "Sphere";
            ShapeType[ShapeType["Box"] = 1] = "Box";
            ShapeType[ShapeType["Capsule"] = 2] = "Capsule";
        })(ShapeType = RigidBody.ShapeType || (RigidBody.ShapeType = {}));
        /**
         * Physics mode
         */
        let PhysicsMode;
        (function (PhysicsMode) {
            PhysicsMode[PhysicsMode["FollowBone"] = 0] = "FollowBone";
            PhysicsMode[PhysicsMode["Physics"] = 1] = "Physics";
            PhysicsMode[PhysicsMode["PhysicsWithBone"] = 2] = "PhysicsWithBone";
        })(PhysicsMode = RigidBody.PhysicsMode || (RigidBody.PhysicsMode = {}));
    })(RigidBody = PmxObject.RigidBody || (PmxObject.RigidBody = {}));
    let Joint;
    (function (Joint) {
        /**
         * Type of the joint
         */
        let Type;
        (function (Type) {
            Type[Type["Spring6dof"] = 0] = "Spring6dof";
            Type[Type["Sixdof"] = 1] = "Sixdof";
            Type[Type["P2p"] = 2] = "P2p";
            Type[Type["ConeTwist"] = 3] = "ConeTwist";
            Type[Type["Slider"] = 4] = "Slider";
            Type[Type["Hinge"] = 5] = "Hinge"; // pmx 2.1 spec (which is not supported by mmd)
        })(Type = Joint.Type || (Joint.Type = {}));
    })(Joint = PmxObject.Joint || (PmxObject.Joint = {}));
    let SoftBody;
    (function (SoftBody) {
        /**
         * Type of the soft body
         */
        let Type;
        (function (Type) {
            Type[Type["TriMesh"] = 0] = "TriMesh";
            Type[Type["Rope"] = 1] = "Rope";
        })(Type = SoftBody.Type || (SoftBody.Type = {}));
        /**
         * Flag of the soft body
         */
        let Flag;
        (function (Flag) {
            Flag[Flag["Blink"] = 1] = "Blink";
            Flag[Flag["ClusterCreation"] = 2] = "ClusterCreation";
            Flag[Flag["LinkCrossing"] = 4] = "LinkCrossing";
        })(Flag = SoftBody.Flag || (SoftBody.Flag = {}));
        /**
         * Aero dynamic model
         */
        let AeroDynamicModel;
        (function (AeroDynamicModel) {
            AeroDynamicModel[AeroDynamicModel["VertexPoint"] = 0] = "VertexPoint";
            AeroDynamicModel[AeroDynamicModel["VertexTwoSided"] = 1] = "VertexTwoSided";
            AeroDynamicModel[AeroDynamicModel["VertexOneSided"] = 2] = "VertexOneSided";
            AeroDynamicModel[AeroDynamicModel["FaceTwoSided"] = 3] = "FaceTwoSided";
            AeroDynamicModel[AeroDynamicModel["FaceOneSided"] = 4] = "FaceOneSided";
        })(AeroDynamicModel = SoftBody.AeroDynamicModel || (SoftBody.AeroDynamicModel = {}));
    })(SoftBody = PmxObject.SoftBody || (PmxObject.SoftBody = {}));
})(PmxObject || (PmxObject = {}));
