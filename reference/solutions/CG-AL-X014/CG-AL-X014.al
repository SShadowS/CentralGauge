codeunit 71030 "CG X014 Finder"
{
    Access = Internal;

    procedure FindByCode(Target: Code[20]): Boolean
    var
        CGX014Item: Record "CG X014 Item";
    begin
        exit(CGX014Item.Get(Target));
    end;
}