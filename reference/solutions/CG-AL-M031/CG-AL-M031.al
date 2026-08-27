namespace CGFqnDemo;

codeunit 70036 "CGFqnWorker"
{
    Access = Public;

    trigger OnRun()
    begin
    end;
}

table 70037 "CGFqnArchive"
{
    Caption = 'CG FQN Archive';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(10; Description; Text[100])
        {
            Caption = 'Description';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}

page 70038 "CGFqnCustomerView"
{
    Caption = 'CG FQN Customer View';
    PageType = Card;
    SourceTable = Microsoft.Sales.Customer.Customer;
    ApplicationArea = All;
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("No."; Rec."No.")
                {
                    ApplicationArea = All;
                }
                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                }
            }
        }
    }
}

report 70039 "CGFqnSalesList"
{
    Caption = 'CG FQN Sales List';
    UsageCategory = None;
    ApplicationArea = All;

    dataset
    {
        dataitem(Customer; Microsoft.Sales.Customer.Customer)
        {
        }
    }
}

codeunit 70040 "CGFqnRunner"
{
    Access = Public;

    procedure RunWorkerByFqn(): Boolean
    begin
        exit(Codeunit.Run('CGFqnDemo.CGFqnWorker'));
    end;

    procedure OpenArchiveTableByFqn(): Integer
    var
        RecRef: RecordRef;
    begin
        RecRef.Open('CGFqnDemo.CGFqnArchive');
        exit(RecRef.Number);
    end;

    procedure InvokePageOverloadsForCompile()
    begin
        if false then begin
            Page.Run('CGFqnDemo.CGFqnCustomerView');
            Page.RunModal('CGFqnDemo.CGFqnCustomerView');
        end;
    end;

    procedure InvokeReportOverloadsForCompile()
    begin
        if false then begin
            Report.Run('CGFqnDemo.CGFqnSalesList');
            Report.RunModal('CGFqnDemo.CGFqnSalesList');
            Report.Execute('CGFqnDemo.CGFqnSalesList', '');
        end;
    end;
}