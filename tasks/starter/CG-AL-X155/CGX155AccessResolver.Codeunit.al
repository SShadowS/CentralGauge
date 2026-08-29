codeunit 71395 "CG X155 Access Resolver"
{
    procedure GetEffectiveRestriction(UserCode: Code[20]; AreaCode: Code[20]): Enum "CG X155 Restriction Level"
    var
        UserRestriction: Record "CG X155 User Restriction";
    begin
        if UserRestriction.Get(UserCode, AreaCode) then
            exit(UserRestriction."Restriction Level");
        exit(Enum::"CG X155 Restriction Level"::Unrestricted);
    end;
}
