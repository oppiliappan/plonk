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
        overlays = [self.overlays.default];
      });
  in {
    overlays.default = final: prev: let
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

    nixosModules.default = {
      config,
      pkgs,
      lib,
      ...
    }:
      with lib; {
        options = {
          services.plonk = {
            enable = mkOption {
              type = types.bool;
              default = false;
              description = "Enable plonk";
            };
            port = mkOption {
              type = types.int;
              default = 3000;
              description = "Port to run plonk on";
            };
            cookie_secret = mkOption {
              type = types.string;
              default = "00000000000000000000000000000000";
              description = "Cookie secret";
            };
          };
        };

        config = mkIf config.services.plonk.enable {
          nixpkgs.overlays = [self.overlays.default];
          systemd.services.plonk = {
            description = "plonk service";
            wantedBy = ["multi-user.target"];

            serviceConfig = {
              ListenStream = "0.0.0.0:${toString config.services.plonk.port}";
              ExecStart = "${pkgs.plonk}/bin/plonk";
              Restart = "always";
            };

            environment = {
              PLONK_PORT = "${toString config.services.plonk.port}";
              PLONK_NODE_ENV = "production";
              PLONK_HOST = "localhost";
              PLONK_PUBLIC_URL = "plonk.li";
              PLONK_DB_PATH = "plonk.db";
              PLONK_COOKIE_SECRET = config.services.plonk.cookie_secret;
            };
          };
        };
      };
  };
}
