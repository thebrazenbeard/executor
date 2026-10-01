<template>
  <pkg-center-step-content>
    <v-form syno-id="executor-install-form">
      <v-form-item label="Executor service URL">
        <v-input v-model="executorUrl" syno-id="executor-url" />
      </v-form-item>
      <v-form-item label="Device ID">
        <v-input v-model="deviceId" syno-id="device-id" />
      </v-form-item>
      <v-form-item label="Device token">
        <v-input type="password" v-model="deviceToken" syno-id="device-token" />
      </v-form-item>
      <v-form-item label="Share roots (comma-separated)">
        <v-input v-model="shareRoots" syno-id="share-roots" />
      </v-form-item>
    </v-form>
  </pkg-center-step-content>
</template>

<script>
import { defineComponent, ref, watchEffect } from 'vue';

export default defineComponent({
  props: {
    ...SYNO.SDS.PkgManApp.Custom.useHook.props,
  },
  setup(props) {
    const { getNext, checkState: updateWizardState } =
      SYNO.SDS.PkgManApp.Custom.useHook(props);
    const executorUrl = ref('');
    const deviceId = ref('DS216');
    const deviceToken = ref('');
    const shareRoots = ref('/volume1/');
    const headline = 'Executor Node Setup';

    const isValid = () => {
      const urlOkay = /^https:\/\/[^\s/]+/i.test(executorUrl.value.trim());
      const deviceOkay = /^[A-Za-z0-9._:-]{1,128}$/.test(deviceId.value.trim());
      return urlOkay && deviceOkay && deviceToken.value.length > 0;
    };

    const checkState = (owner) => {
      owner = owner ?? props.getOwner();
      updateWizardState(owner);
      owner.getButton('next').setDisabled(!isValid());
    };

    const getValues = () => [{
      wizard_executor_url: executorUrl.value.trim(),
      wizard_device_id: deviceId.value.trim(),
      wizard_device_token: deviceToken.value,
      wizard_share_roots: shareRoots.value.trim(),
    }];

    watchEffect(() => {
      executorUrl.value;
      deviceId.value;
      deviceToken.value;
      shareRoots.value;
      checkState();
    });
    return {
      getNext,
      checkState,
      headline,
      getValues,
      executorUrl,
      deviceId,
      deviceToken,
      shareRoots,
    };
  },
});
</script>
