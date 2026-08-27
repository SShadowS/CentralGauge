table 70002 "Sales Contract"
{
    Caption = 'Sales Contract';
    DataClassification = CustomerContent;
    LookupPageId = "Customer List";
    DrillDownPageId = "Customer List";

    fields
    {
        field(1; "Contract No."; Code[20])
        {
            Caption = 'Contract No.';
            DataClassification = CustomerContent;
        }
        field(2; "Customer No."; Code[20])
        {
            Caption = 'Customer No.';
            DataClassification = CustomerContent;
            TableRelation = Customer."No.";

            trigger OnValidate()
            var
                Customer: Record Customer;
            begin
                if "Customer No." <> '' then
                    Customer.Get("Customer No.");
            end;
        }
        field(3; "Start Date"; Date)
        {
            Caption = 'Start Date';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                if ("End Date" <> 0D) and ("Start Date" <> 0D) then
                    if "End Date" <= "Start Date" then
                        Error(EndDateAfterStartDateErr);
            end;
        }
        field(4; "End Date"; Date)
        {
            Caption = 'End Date';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                if ("End Date" <> 0D) and ("Start Date" <> 0D) then
                    if "End Date" <= "Start Date" then
                        Error(EndDateAfterStartDateErr);
            end;
        }
        field(5; "Contract Value"; Decimal)
        {
            Caption = 'Contract Value';
            DataClassification = CustomerContent;
            DecimalPlaces = 2 : 2;

            trigger OnValidate()
            begin
                if "Contract Value" <= 0 then
                    Error(ContractValuePositiveErr);
            end;
        }
        field(6; Status; Option)
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
            OptionMembers = Draft,Active,Suspended,Terminated,Closed;
            OptionCaption = 'Draft,Active,Suspended,Terminated,Closed';
        }
        field(7; "Payment Terms"; Code[10])
        {
            Caption = 'Payment Terms';
            DataClassification = CustomerContent;
            TableRelation = "Payment Terms".Code;
        }
    }

    keys
    {
        key(PK; "Contract No.")
        {
            Clustered = true;
        }
        key(CustomerKey; "Customer No.")
        {
        }
    }

    trigger OnInsert()
    begin
        if "Contract No." = '' then
            "Contract No." := GetNextContractNo();
        Status := Status::Draft;
    end;

    trigger OnDelete()
    begin
        if Status = Status::Active then
            Error(CannotDeleteActiveErr);
    end;

    var
        EndDateAfterStartDateErr: Label 'End Date must be after Start Date';
        ContractValuePositiveErr: Label 'Contract Value must be positive';
        CannotDeleteActiveErr: Label 'Cannot delete active contract';

    local procedure GetNextContractNo(): Code[20]
    var
        SalesContract: Record "Sales Contract";
    begin
        SalesContract.SetCurrentKey("Contract No.");
        if SalesContract.FindLast() then
            exit(IncStr(SalesContract."Contract No."));
        exit('SC00001');
    end;
}