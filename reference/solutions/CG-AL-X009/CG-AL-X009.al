codeunit 70980 "CG X009 Creator"
{
    Access = Internal;

    procedure CreateDoc(NewCode: Code[20]; NewBase: Integer): Integer
    var
        CGX009Doc: Record "CG X009 Doc";
    begin
        CGX009Doc.Init();
        CGX009Doc.Validate("Code", NewCode);
        CGX009Doc.Validate("Base", NewBase);
        CGX009Doc.Insert(true);
        CGX009Doc.Get(NewCode);
        exit(CGX009Doc."Computed");
    end;
}