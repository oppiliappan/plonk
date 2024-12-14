{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    supportedSystems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    nixpkgsFor = forAllSystems (system:
      import nixpkgs {
        inherit system;
        overlays = [self.overlay.default];
      });
  in {
    overlay.default = final: prev: let
      pname = "plonk";
      version = "0.1.0";
    in {
      plonk = with final;
        buildNpmPackage {
          inherit pname version;
          src = ./.;
          packageJson = ./package.json;
          buildPhase = "npm run build";
          npmDepsHash = "sha256-qGCbaFAHd/s9hOTWMjHCam6Kf6pU6IWPybfwYh0sOwc=";
        };
    };

    packages = forAllSystems (system: {
      inherit (nixpkgsFor."${system}") plonk;
    });

    defaultPackage = forAllSystems (system: nixpkgsFor."${system}".plonk);

    devShell = forAllSystems (system: let
      pkgs = nixpkgsFor."${system}";
    in
      pkgs.mkShell {
        nativeBuildInputs = [
          pkgs.nodejs
          pkgs.biome
          pkgs.typescript
          pkgs.nodePackages.typescript-language-server
        ];
      });

    formatter = forAllSystems (system: nixpkgsFor."${system}".alejandra);
  };
}
