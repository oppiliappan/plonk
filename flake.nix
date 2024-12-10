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
      import nixpkgs { inherit system; });
  in {

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
