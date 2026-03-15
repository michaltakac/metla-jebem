require 'json'

# Load the spm_dependency helper from React Native
react_native_path = File.join(
  File.dirname(`node --print "require.resolve('react-native/package.json')"`),
  "scripts/react_native_pods"
)
require react_native_path

Pod::Spec.new do |s|
  s.name           = 'ExpoSmolVLM'
  s.version        = '0.1.0'
  s.summary        = 'On-device vision-language model inference using SmolVLM2 via MLX'
  s.description    = 'Expo module wrapping MLX Swift for on-device SmolVLM2 inference'
  s.license        = 'MIT'
  s.author         = 'example'
  s.homepage       = 'https://github.com/example'
  s.platforms      = { :ios => '17.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # MLX Swift examples (includes MLXVLM for SmolVLM2 support)
  spm_dependency(s,
    url: 'https://github.com/ml-explore/mlx-swift-examples',
    requirement: { kind: 'exactVersion', version: '2.29.1' },
    products: ['MLXLMCommon', 'MLXVLM']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.swift'
end
