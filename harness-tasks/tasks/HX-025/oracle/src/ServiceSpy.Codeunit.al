codeunit 85961 "HX025 Service Spy"
{
    EventSubscriberInstance = Manual;

    var
        Notifications: Integer;

    procedure NotifiedCount(): Integer
    begin
        exit(Notifications);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Service Plan Mgt", 'OnAfterServiceRegistered', '', false, false)]
    local procedure CountServiceRegistered(var Vehicle: Record "CGR Vehicle")
    begin
        Notifications += 1;
    end;
}
