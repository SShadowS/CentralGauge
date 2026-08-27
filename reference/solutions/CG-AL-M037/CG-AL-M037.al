enum 70038 "CG Demo Event Category"
{
    Extensible = false;

    value(0; Uncategorized)
    {
        Caption = 'Uncategorized';
    }
    value(1; Sales)
    {
        Caption = 'Sales';
    }
}

enumextension 70038 "CG Event Category Ext" extends EventCategory
{
    value(70038; Sales)
    {
        Caption = 'Sales';
    }
}

codeunit 70037 "CG ExtBizEvent Demo"
{
    Access = Public;

    [ExternalBusinessEvent('cgSalesEvent', '[OBSOLETE] CG Sales Event', 'Original sales event', Enum::EventCategory::Sales, '1.0')]
    [Obsolete('Replaced by v2.0', '27.0')]
    procedure CGSalesEventV1()
    begin
    end;

    [ExternalBusinessEvent('cgSalesEvent', 'CG Sales Event', 'Renamed event in v2', Enum::EventCategory::Sales, '2.0')]
    procedure CGSalesEventV2()
    begin
    end;
}