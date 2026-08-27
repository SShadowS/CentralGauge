interface INotificationChannel
{
    procedure Send(Message: Text): Boolean;
    procedure GetChannelName(): Text;
}

codeunit 70221 "CG Email Channel" implements INotificationChannel
{
    Access = Public;

    procedure Send(Message: Text): Boolean
    begin
        exit(true);
    end;

    procedure GetChannelName(): Text
    begin
        exit('Email');
    end;
}

codeunit 70222 "CG SMS Channel" implements INotificationChannel
{
    Access = Public;

    procedure Send(Message: Text): Boolean
    begin
        exit(true);
    end;

    procedure GetChannelName(): Text
    begin
        exit('SMS');
    end;
}

codeunit 70223 "CG Slack Channel" implements INotificationChannel
{
    Access = Public;

    procedure Send(Message: Text): Boolean
    begin
        exit(true);
    end;

    procedure GetChannelName(): Text
    begin
        exit('Slack');
    end;
}

codeunit 70220 "CG Notification Manager"
{
    Access = Public;

    var
        Channels: List of [Interface INotificationChannel];
        NamedChannels: Dictionary of [Text, Interface INotificationChannel];

    procedure RegisterChannel(Channel: Interface INotificationChannel)
    begin
        Channels.Add(Channel);
    end;

    procedure BroadcastMessage(Message: Text): Integer
    var
        Channel: Interface INotificationChannel;
        SuccessCount: Integer;
    begin
        SuccessCount := 0;
        foreach Channel in Channels do
            if Channel.Send(Message) then
                SuccessCount += 1;
        exit(SuccessCount);
    end;

    procedure GetRegisteredChannelNames(): List of [Text]
    var
        Channel: Interface INotificationChannel;
        ChannelNames: List of [Text];
    begin
        foreach Channel in Channels do
            ChannelNames.Add(Channel.GetChannelName());
        exit(ChannelNames);
    end;

    procedure RegisterNamedChannel(Name: Text; Channel: Interface INotificationChannel)
    begin
        NamedChannels.Set(Name, Channel);
    end;

    procedure SendToChannel(Name: Text; Message: Text): Boolean
    var
        Channel: Interface INotificationChannel;
    begin
        if not NamedChannels.ContainsKey(Name) then
            exit(false);
        Channel := NamedChannels.Get(Name);
        exit(Channel.Send(Message));
    end;

    procedure GetChannelByName(Name: Text; var Channel: Interface INotificationChannel): Boolean
    begin
        if not NamedChannels.ContainsKey(Name) then
            exit(false);
        Channel := NamedChannels.Get(Name);
        exit(true);
    end;

    procedure ClearChannels()
    var
        EmptyChannels: List of [Interface INotificationChannel];
        EmptyNamedChannels: Dictionary of [Text, Interface INotificationChannel];
    begin
        Channels := EmptyChannels;
        NamedChannels := EmptyNamedChannels;
    end;
}