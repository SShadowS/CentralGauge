codeunit 70935 "CG X133 Display Resolver"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X133 Display Row Builder", 'OnResolveDisplayContext', '', false, false)]
    local procedure ResolveDisplayContext(OwnerCode: Code[20]; TeamCode: Code[20]; var OwnerDisplay: Text[100]; var TeamDisplay: Text[100])
    var
        Person: Record "CG X133 Person";
        Team: Record "CG X133 Team";
    begin
        if Person.Get(OwnerCode) then
            OwnerDisplay := Person."Display Name";
        if Team.Get(TeamCode) then
            TeamDisplay := Team."Display Name";
    end;
}
