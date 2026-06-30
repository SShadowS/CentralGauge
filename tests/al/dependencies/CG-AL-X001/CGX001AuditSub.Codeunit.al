codeunit 69602 "CG X001 Audit Sub"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X001 Publisher", 'OnPing', '', false, false)]
    local procedure OnPing()
    var
        Counter: Record "CG X001 Counter";
    begin
        if not Counter.Get('') then begin
            Counter.Init();
            Counter."Primary Key" := '';
            Counter.Insert();
        end;
        Counter."Count" += 1;
        Counter.Modify();
    end;
}
