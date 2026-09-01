table 70782 "CG X118 Journal Line"
{
    Caption = 'CG X118 Journal Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            DataClassification = CustomerContent;
        }
        field(2; "Account No."; Code[20])
        {
            Caption = 'Account No.';
            DataClassification = CustomerContent;
            TableRelation = "CG X118 Account"."No.";

            trigger OnValidate()
            var
                Account: Record "CG X118 Account";
            begin
                if Rec."Account No." = '' then begin
                    Rec."Currency Code" := '';
                    exit;
                end;

                Account.Get(Rec."Account No.");
                Rec."Currency Code" := Account."Currency Code";
            end;
        }
        field(3; "Counter Account No."; Code[20])
        {
            Caption = 'Counter Account No.';
            DataClassification = CustomerContent;
            TableRelation = "CG X118 Account"."No.";

            trigger OnValidate()
            var
                JournalLineMgt: Codeunit "CG X118 Journal Line Mgt";
            begin
                JournalLineMgt.AssignCounterAccount(Rec);
            end;
        }
        field(4; "Currency Code"; Code[10])
        {
            Caption = 'Currency Code';
            DataClassification = CustomerContent;
            TableRelation = "CG X118 Currency".Code;
        }
        field(5; Amount; Decimal)
        {
            Caption = 'Amount';
            DataClassification = CustomerContent;
            DecimalPlaces = 0 : 5;

            trigger OnValidate()
            var
                JournalLineMgt: Codeunit "CG X118 Journal Line Mgt";
            begin
                JournalLineMgt.AssignCounterAccount(Rec);
            end;
        }
        field(6; "Balancing Amount"; Decimal)
        {
            Caption = 'Balancing Amount';
            DataClassification = CustomerContent;
            DecimalPlaces = 0 : 5;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
