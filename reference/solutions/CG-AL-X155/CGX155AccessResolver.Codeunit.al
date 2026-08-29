codeunit 71395 "CG X155 Access Resolver"
{
    procedure GetEffectiveRestriction(UserCode: Code[20]; AreaCode: Code[20]): Enum "CG X155 Restriction Level"
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Effective: Enum "CG X155 Restriction Level";
    begin
        Effective := Enum::"CG X155 Restriction Level"::Unrestricted;

        if UserRestriction.Get(UserCode, AreaCode) then
            if UserRestriction."Restriction Level".AsInteger() > Effective.AsInteger() then
                Effective := UserRestriction."Restriction Level";

        GroupMember.SetRange("User Code", UserCode);
        if GroupMember.FindSet() then
            repeat
                if GroupRestriction.Get(GroupMember."Group Code", AreaCode) then
                    if GroupRestriction."Restriction Level".AsInteger() > Effective.AsInteger() then
                        Effective := GroupRestriction."Restriction Level";
            until GroupMember.Next() = 0;

        exit(Effective);
    end;
}
