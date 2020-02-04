#!/bin/bash
set -e

time=$(date +"%Y%m%d_%H%M")
file_name_prefix="hycon_0.2.0_"${time}
#build_time=${1:?"requires an argument DateTime" }
os=${1:?"requires an argument mac | linux | win | all" }

function docker_build() {
    local file_name=${file_name_prefix}'_docker.tar'
    sudo docker build . -t ${file_name_prefix}
    sudo docker save --output ${file_name} ${file_name_prefix}
    sudo docker rmi ${file_name_prefix}
    sudo chmod 777 ${file_name}
}

if [[ ${os} != "docker" ]] && [[ ${os} != "linux" ]] && [[ ${os} != "win" ]] && [[ ${os} != "mac" ]] && [[ ${os} != "all" ]]
then
    echo "================== Error: platform not supported  ==============="
    exit 1
fi

if [[ ${os} == "docker" ]]
then
    if [[ -e "./src/api/clientDist" ]]
    then
        rm -rf ./src/api/clientDist
    fi
    npm run clear
    docker_build
    exit 0
fi

output_dir=bundle-${os}
#build_time=$(date +"%Y%m%d_%I%M")
file_name=${file_name_prefix}'_'${os}'.zip'

npm i
cp ./types/Button.d.ts ./node_modules/@material-ui/core/Button/
npm run clear
npm run test
rm -rf build
tsc

echo "=============== npm  tsc init finish============="
if [[ -e "./src/api/clientDist" ]]
then    
    rm -rf ./src/api/clientDist
fi

npm run clear
npm run block:build
echo "==================UI build finish==============="
function platform_dependent() {
    local platform=$1
    local output_dir=bundle-${platform}
    local file_name=${file_name_prefix}'_'${platform}'.zip'
    pkg . --target ${platform} -o hycon
    if [[ -e ${output_dir} ]]
    then
        rm -rf ${output_dir}
    fi
    mkdir ${output_dir}
    cd ${output_dir}
    cp -rf ../data .
    cp -f ../platform/${platform}/node-modules/* .

    if [[ ${platform} == "win" ]]
    then
        cp -f ../hycon.exe .       
        cp -f ../launch.bat .
        rm -rf ../hycon.exe
    elif [[ ${platform} == "linux" ]] || [[ ${platform} == "mac" ]]
    then
        cp -f ../hycon .
        cp -f ../launch.sh.command .
    else
        echo "================== Error: platform not found ==============="
        exit 1
    fi
    cp -f ../documents/* .
    mkdir node_modules
    cp -rf ../node_modules/react* ./node_modules/

    rm data/config.json
    cp ../platform/${platform}/config/* data/

    local OS="$(awk -F= '/^NAME/{print $2}' /etc/os-release)"

    if [[ ${OS} == "\"CentOS Linux\"" ]]
    then
	echo "start copy for centos ......"
        find ../node_modules/ -type f -name '*.node'  -exec cp {} .  \;
    fi

    cd ..
    zip -r ${file_name} ${output_dir}
}

if [[ ${os} == "all" ]]
then
    platform_dependent "win"
    platform_dependent "linux"
    platform_dependent "mac"
else
    platform_dependent ${os}
fi
