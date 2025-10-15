<p align="center">
  <img src="https://i.imgur.com/FIGZdR3.png">
</p>

Current version: **4.13.7**

# About
This takes programming from various providers and transforms it into a "live TV" experience with virtual linear channels. It will discover what is on, and generate a schedule of channels that will give you M3U and XMLTV files that you can import into something like [Jellyfin](https://jellyfin.org) or [Channels](https://getchannels.com).

## Notes
* This was not made for pirating streams. This is made for using your own credentials and have a different presentation than the streaming apps currently provide.
* The Mouse might not like it and it could be taken down at any minute. Enjoy it while it lasts. ¯\\_(ツ)_/¯

# Using
The server exposes 4 main endpoints:

| Endpoint | Description |
|---|---|
| /channels.m3u | The channel list you'll import into your client |
| /xmltv.xml | The schedule that you'll import into your client |
| /linear-channels.m3u | The linear channel list you'll import into your client (only used when using the dedicated linear channels option) |
| /linear-xmltv.xml | The linear schedule that you'll import into your client (only used when using the dedicated linear channels option) - Not needed for Channels DVR |

# Running
The recommended way of running is to pull the image from [Docker Hub](https://hub.docker.com/r/tonywagner/eplustv).

## Environment Variables
| Environment Variable | Description | Required? | Default |
|---|---|---|---|
| BASE_URL | If using a reverse proxy, m3u will be generated with this as the base. | No | - |
| PUID | Current user ID. Use if you have permission issues. Needs to be combined with PGID. | No | - |
| PGID | Current group ID. Use if you have permission issues. Needs to be combined with PUID. | No | - |
| PORT | Port the API will be served on. You can set this if it conflicts with another service in your environment. | No | 8000 |

### Available Providers

#### Bally

Available for free

#### B1G+

Available to login with B1G+ credentials (or for free with certain ISP providers)

#### CBS Sports

Available to login with TV Provider. Please note that there is no token refresh option here. It will require re-authenticating every 30 days.

#### ESPN

Available to login with TV Provider

##### Linear Channels

Will create dedicated linear channels if using dedicated linear channels, otherwise will schedule events normally

| Network Name | Description |
|---|---|
| ESPN | Set if your TV provider supports it |
| ESPN2 | Set if your TV provider supports it |
| ESPNU | Set if your TV provider supports it |
| SEC Network | Set if your TV provider supports it |
| ACC Network | Set if your TV provider supports it |
| ESPNews | Set if your TV provider supports it |

##### Digital Networks

| Network Name | Description |
|---|---|
| ESPN3 | Set if your TV provider or ISP supports it |
| SEC Network+ | Set if your TV provider supports it |
| ACC Network Extra | Set if your TV provider supports it |

#### ESPN+

Available to login with ESPN+ credentials

##### Extras
| Name | Description |
|---|---|
| ESPN+ PPV | Schedule ESPN+ PPV events |

#### FloSports

Available to login with FloSports credentials

#### FOX One
*** This is currently experimental  ***

Available to login with TV Provider - Direct Subscription or ESPN Subscription Not Currently Supported

##### Linear Channels
Must Use Linear Channels to Function Correctly.  

To get Local Fox Guide Data Environmental Variables Must Be Set:
FOX_STATION_ID: Local Fox Gracenote Station ID, example: FOX_STATION_ID=20360
FOX_TVG_NAME: Local Station Call Sign, example: FOX_TVG_NAME=WNYW
If no station is defined it will default to New York's Fox station WNYW

| Network Name |
|---|
| FOX |
| FS1 |
| FS2 |
| B1G Network |
| FOX Deportes |
| FOX News Channel |
| FOX Business Network |
| TMZ |
| Masked Singer |
| FOX Soul |
| FOX Weather |
| FOX Live Now |

#### FOX Sports

Available to login with TV Provider

##### Linear Channels

Some events are on linear channels and some aren't. If you use dedicated linear channels, only events that are on FOX will be scheduled normally. All other events will be scheduled to linear channels

| Network Name |
|---|
| FS1 |
| FS2 |
| B1G Network |
| FOX Soccer Plus |
| FOX Deportes |

#### Gotham Sports

Available to login with Gotham Sports or TV Provider

##### Linear Channels

Will create dedicated linear channels if using dedicated linear channels, otherwise will schedule events normally

| Network Name | Description |
|---|---|
| MSG | MSG (If in your supported zone) |
| MSGSN | MSG Sportsnet HD (If in your supported zone) |
| MSG2 | MSG2 HD (If in your supported zone) |
| MSGSN2 | MSG Sportsnet 2 HD (If in your supported zone) |
| YES | Yes Network (If in your supported zone) |

#### Hudl

Various small college conferences, available for free

#### KBO

Available for free

#### KSL Sports

Available for free

#### LOVB Live

Available for free

#### MLB.tv

Available to login with MLB.tv credentials

##### Extras
| Name | Description |
|---|---|
| Only free games | If you have a free account, only 1 free game per day will be scheduled |

##### Linear Channels

| Network Name | Description |
|---|---|
| Big Inning | Will create a dedicated linear channel if using dedicated linear channels, otherwise will schedule Big Inning normally |
| MLB Network | Only available if you have MLB Network as part of your MLB.tv account or have linked TVE Provider that provides access |
| SNY | Only available if you have SNY as part of your MLB.tv account or have linked TVE Provider that provides access |
| SNLA | Only available if you have SNLA+ as part of your MLB.tv account or have linked TVE Provider that provides access |

#### Mountain West

Available for free

#### NHL.tv

Available to login with NHL.tv account (Europe only)

#### NFL

Available to login with NFL.com credentials

This integration works with NFL+ or using other providers (TVE, Amazon Prime, Peacock, Sunday Ticket) to access games.

##### Extra Providers

If you don't have an NFL+ subscription, you can use these providers to access games.

| Provider Name | Description |
|---|---|
| Amazon Prime | Get TNF games from Amazon Prime |
| Peacock | Get SNF games from Peacock |
| TV Provider | Get in-market games from your TV Provider |
| Sunday Ticket | Get out-of-market games from Youtube |

##### Linear Channels

If you have access to NFL RedZone, it will be scheduled. If dedicated linear channels is set, it will be on its own channel

| Network Name | Description |
|---|---|
| NFL Network | NFL+ or TV Provider access |
| NFL RedZone | NFL+ Premium or TV Provider access |
| NFL Channel | Free channel for all accounts |

#### NWSL+

Available to login with NWSL+ credentials

#### Outside TV

Available to login with Outside TV credentials (free account)

##### Linear Channels

Dedicated linear channels - Will only schedule when dedicated linear channels is set

| Network Name |
|---|
| Outside |

#### Paramount+

Available to login with Paramount+ credentials

##### Linear Channels

Dedicated linear channels - Will only schedule when dedicated linear channels is set

| Network Name | Description |
|---|---|
| CBS Sports HQ | Set if your TV provider supports it |
| Golazo Network | Set if your TV provider supports it |

#### PWHL

Available for free

#### Victory+

Available to login with Victory+ credentials.

#### WNBA League Pass

Available to login with WNBA League Pass credentials

#### Women's Sports Network

Available for free - only linear channel

##### Linear Channels

| Network Name | Description |
|---|---|
| WSN | Women's Sports Network |

#### Zeam Live Events

Available for free

## Volumes
| Volume Name | Description | Required? |
|---|---|---|
| /app/config | Used to store DB and application state | Yes |


## Docker Run
By default, the easiest way to get running is:

```bash
docker run -p 8000:8000 -v config_dir:/app/config tonywagner/eplustv
```

If you run into permissions issues:

```bash
docker run -p 8000:8000 -v config_dir:/app/config -e PUID=$(id -u $USER) -e PGID=$(id -g $USER) tonywagner/eplustv
```

Open the service in your web browser at `http://<ip>:8000`
