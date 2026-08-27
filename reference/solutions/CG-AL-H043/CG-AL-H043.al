codeunit 70430 "CG H043 Url Guard"
{
    Access = Public;

    procedure SameHost(ServiceUrl: Text; BaseUrl: Text): Boolean
    var
        Uri: Codeunit "Uri";
    begin
        exit(Uri.AreURIsHaveSameHost(ServiceUrl, BaseUrl));
    end;
}