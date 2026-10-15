codeunit 87042 "HX079 Portal Runner"
{
    var
        RunMode: Option SignIn,Forget,ForgetThenFail;
        LaterStepErr: Label 'HX079 later step failed.';

    procedure HX79SetSignIn()
    begin
        RunMode := RunMode::SignIn;
    end;

    procedure HX79SetForget()
    begin
        RunMode := RunMode::Forget;
    end;

    procedure HX79SetForgetThenFail()
    begin
        RunMode := RunMode::ForgetThenFail;
    end;

    trigger OnRun()
    var
        PortalSession: Codeunit "CGR Portal Session";
    begin
        case RunMode of
            RunMode::SignIn:
                PortalSession.PortalSignIn();
            RunMode::Forget:
                PortalSession.ForgetPortalToken();
            RunMode::ForgetThenFail:
                begin
                    PortalSession.ForgetPortalToken();
                    Error(LaterStepErr);
                end;
        end;
    end;
}
