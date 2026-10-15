codeunit 87041 "HX079 Portal Partner"
{
    EventSubscriberInstance = Manual;

    var
        IssuedToken: Text;
        QueueMarker: Boolean;
        RefuseRegistration: Boolean;
        CallCount: Integer;
        SeenToken: Text;
        StoredAtEvent: Text;
        RefusedErr: Label 'HX079 registration refused.';

    procedure HX79Configure(NewIssuedToken: Text; NewQueueMarker: Boolean; NewRefuse: Boolean)
    begin
        IssuedToken := NewIssuedToken;
        QueueMarker := NewQueueMarker;
        RefuseRegistration := NewRefuse;
    end;

    procedure HX79ResetCalls()
    begin
        CallCount := 0;
        SeenToken := '';
        StoredAtEvent := '';
    end;

    procedure HX79Calls(): Integer
    begin
        exit(CallCount);
    end;

    procedure HX79SeenToken(): Text
    begin
        exit(SeenToken);
    end;

    procedure HX79StoredAtEvent(): Text
    begin
        exit(StoredAtEvent);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Portal Session", 'OnIssuePortalToken', '', false, false)]
    local procedure HX79IssueToken(var NewToken: Text)
    begin
        NewToken := IssuedToken;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Portal Session", 'OnAfterPortalSignIn', '', false, false)]
    local procedure HX79Register(NewToken: Text)
    var
        PortalSession: Codeunit "CGR Portal Session";
        Facade: Codeunit "CGR Integration Facade";
    begin
        CallCount += 1;
        SeenToken := NewToken;
        StoredAtEvent := PortalSession.PortalToken();
        if QueueMarker then
            Facade.QueueVehicleCheckedOut('HX079-MARK');
        if RefuseRegistration then
            Error(RefusedErr);
    end;
}
