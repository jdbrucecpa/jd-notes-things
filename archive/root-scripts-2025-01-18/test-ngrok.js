const ngrok = require('ngrok');
require('dotenv').config();

async function testNgrok() {
  try {
    console.log('Testing ngrok setup...');
    console.log('NGROK_AUTHTOKEN exists:', !!process.env.NGROK_AUTHTOKEN);
    console.log('NGROK_DOMAIN:', process.env.NGROK_DOMAIN);

    // Set authtoken
    console.log('\n1. Setting authtoken...');
    await ngrok.authtoken(process.env.NGROK_AUTHTOKEN);
    console.log('✓ Authtoken set successfully');

    // Connect without domain first (simple test)
    console.log('\n2. Testing basic connection (random URL)...');
    const randomUrl = await ngrok.connect({
      addr: 8080,
      proto: 'http',
      // ngrok v3 doesn't use 'region' option the same way
    });
    console.log('✓ Basic connection successful!');
    console.log('   Random URL:', randomUrl);

    // Disconnect
    console.log('\n3. Disconnecting...');
    await ngrok.disconnect();
    console.log('✓ Disconnected');

    // Now test with custom domain
    console.log('\n4. Testing with custom domain...');
    const cleanDomain = process.env.NGROK_DOMAIN.replace(/^https?:\/\//, '');
    console.log('   Using domain:', cleanDomain);

    const customUrl = await ngrok.connect({
      addr: 8080,
      proto: 'http',
      domain: cleanDomain,
    });
    console.log('✓ Custom domain connection successful!');
    console.log('   Custom URL:', customUrl);

    console.log('\n5. Keeping tunnel open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('\n6. Disconnecting...');
    await ngrok.disconnect();
    await ngrok.kill();
    console.log('✓ All tests passed!');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

testNgrok();
